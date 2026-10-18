"""UpstreamAdapter implementations: Terrain Tiles stitching/overzoom, Copernicus, skeletons."""

from __future__ import annotations

import io

import httpx
import numpy as np
import pytest
from PIL import Image

from tiles_service.adapters.base import TileNotFound, UpstreamAdapter, SourceUnavailable
from tiles_service.adapters.copernicus import CopernicusGlo30Adapter, cop_cell_name
from tiles_service.adapters.roads import RoadsAdapter
from tiles_service.adapters.terrain_tiles import TerrainTilesAdapter
from tiles_service.adapters.worldcover import WorldCoverAdapter
from tiles_service.config import SourceConfig
from tiles_service.metrics import Metrics
from tiles_service.terrarium import decode_rgb, encode_heights
from tiles_service.upstream import UpstreamClient


def source(**kw) -> SourceConfig:
    base = dict(id="terrain-tiles", tipo="terrain_tiles", nombre="TT", atribucion="USGS", licencia="PD",
                params={"url_base": "https://tiles.test", "zoom_max_fuente": 15, "zoom_real_fuente": 12},
                tasa_por_s=1000, rafaga=1000, concurrencia=8, reintentos=0, espera_inicial_s=0.0)
    base.update(kw)
    return SourceConfig(**base)


def png256(value: float) -> bytes:
    rgb = encode_heights(np.full((256, 256), value))
    buf = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(buf, format="PNG")
    return buf.getvalue()


def tt_adapter(handler):
    cfg = source()
    client = UpstreamClient(cfg, contact="t@example.org", metrics=Metrics(), transport=httpx.MockTransport(handler))
    return TerrainTilesAdapter(cfg, client)


@pytest.mark.anyio
async def test_terrain_tiles_stitches_four_children_of_z_plus_1():
    seen = []

    def handler(request: httpx.Request):
        seen.append(request.url.path)
        _, fmt, z, x, y = request.url.path.split("/")
        x, y = int(x), int(y.removesuffix(".png"))
        return httpx.Response(200, content=png256(1000 + (x % 2) * 10 + (y % 2) * 100))

    tile = await tt_adapter(handler).fetch(3, 2, 5, max_real_zoom=11)
    assert sorted(seen) == sorted(f"/terrarium/4/{x}/{y}.png" for x in (4, 5) for y in (10, 11))
    h = decode_rgb(tile.rgb)
    assert tile.rgb.shape == (512, 512, 3) and not tile.overzoom
    assert h[10, 10] == 1000 and h[10, 300] == 1010 and h[300, 10] == 1100 and h[300, 300] == 1110


@pytest.mark.anyio
async def test_terrain_tiles_overzoom_resamples_max_real_zoom_and_flags_it():
    seen = []

    def handler(request: httpx.Request):
        seen.append(request.url.path)
        rgb = encode_heights(np.tile(np.arange(256, dtype=np.float64), (256, 1)))
        buf = io.BytesIO()
        Image.fromarray(rgb, "RGB").save(buf, format="PNG")
        return httpx.Response(200, content=buf.getvalue())

    # z13 (512 px) lies inside 256-px source tile z12 (13>>1) -> one request, no z14 data used
    tile = await tt_adapter(handler).fetch(13, 4097, 8195, max_real_zoom=11)
    assert seen == ["/terrarium/12/2048/4097.png"]
    assert tile.overzoom is True
    h = decode_rgb(tile.rgb)
    # x=4097 is the right half of the z12 tile: source columns 128..255 upsampled x4
    assert 127 <= h[0, 0] <= 129 and 254 <= h[0, -1] <= 255.5


@pytest.mark.anyio
async def test_terrain_tiles_all_children_missing_is_not_found():
    adapter = tt_adapter(lambda r: httpx.Response(404))
    with pytest.raises(TileNotFound):
        await adapter.fetch(3, 2, 5, max_real_zoom=11)


@pytest.mark.anyio
async def test_terrain_tiles_upstream_failure_is_unavailable():
    adapter = tt_adapter(lambda r: httpx.Response(500))
    with pytest.raises(SourceUnavailable):
        await adapter.fetch(3, 2, 5, max_real_zoom=11)


def test_copernicus_cell_naming_uses_lower_left_corner():
    assert cop_cell_name(-13, -78) == "Copernicus_DSM_COG_10_S13_00_W078_00_DEM"
    assert cop_cell_name(0, -70) == "Copernicus_DSM_COG_10_N00_00_W070_00_DEM"


@pytest.mark.anyio
async def test_copernicus_reads_local_cog_and_fills_missing_cells_with_sea_level(tmp_path):
    import rasterio
    from rasterio.transform import from_origin

    # synthetic 1x1 degree cell S13 W078 (lat -13..-12, lon -78..-77), 360 px, height = 1000 + row
    name = cop_cell_name(-13, -78)
    (tmp_path / name).mkdir()
    data = (1000 + np.repeat(np.arange(360, dtype=np.float32)[:, None], 360, axis=1))
    with rasterio.open(tmp_path / name / f"{name}.tif", "w", driver="GTiff", width=360, height=360, count=1,
                       dtype="float32", crs="EPSG:4326", transform=from_origin(-78, -12, 1 / 360, 1 / 360)) as ds:
        ds.write(data, 1)

    cfg = SourceConfig(id="copernicus-glo30", tipo="copernicus_glo30", nombre="Cop", atribucion="DLR", licencia="Cop",
                       params={"url_base": str(tmp_path), "local": True, "overviews": []}, modelo_superficie=True,
                       tasa_por_s=1000, rafaga=1000, concurrencia=4, reintentos=0, espera_inicial_s=0.0)
    adapter = CopernicusGlo30Adapter(cfg, UpstreamClient(cfg, contact="t", metrics=Metrics()))
    from tiles_service.tilemath import lonlat_to_tile

    x, y = lonlat_to_tile(-77.5, -12.5, 9)  # z9 512 px tile ~0.7 deg wide, around the cell centre
    tile = await adapter.fetch(9, x, y, max_real_zoom=11)
    h = decode_rgb(tile.rgb)
    assert tile.rgb.shape == (512, 512, 3)
    assert not tile.overzoom
    vals = h[~np.isnan(h)]
    assert vals.size == 512 * 512  # cell + ocean cover the whole tile, no holes
    assert ((vals == 0) | ((vals >= 1000) & (vals <= 1360))).all()
    col = int(np.argmax(h[256] > 0))  # first column east of lon -78 (west edge of the cell)
    assert 0 < col < 512
    assert h[100, col + 10] < h[400, col + 10]  # heights grow southwards like the source rows
    # pixels outside the synthetic cell belong to cells that do not exist -> 0 m (ocean)
    assert (h == 0).any()


@pytest.mark.parametrize("cls", [WorldCoverAdapter, RoadsAdapter])
def test_skeleton_adapters_follow_the_interface(cls):
    assert issubclass(cls, UpstreamAdapter)
    assert isinstance(cls.PLANNED_TRANSFORM, str) and len(cls.PLANNED_TRANSFORM) > 40
    adapter = cls(SourceConfig(id=cls.__name__, tipo="x", nombre="n", atribucion="a", licencia="l"), None)
    import asyncio

    with pytest.raises(NotImplementedError):
        asyncio.run(adapter.fetch(10, 300, 540, max_real_zoom=11))


def test_worldcover_planned_transform_is_majority_without_interpolation():
    assert "mayor" in WorldCoverAdapter.PLANNED_TRANSFORM.lower()
    assert "sin interpolación" in WorldCoverAdapter.PLANNED_TRANSFORM.lower()
    assert "geofabrik" in RoadsAdapter.PLANNED_TRANSFORM.lower()
