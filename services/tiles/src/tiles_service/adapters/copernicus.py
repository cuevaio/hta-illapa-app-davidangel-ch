"""Copernicus DEM GLO-30 (COG, float32, EPSG:4326, 1x1 degree cells) -> internal 512 px Terrarium.

Windowed reads over HTTP range (GDAL /vsicurl/), reprojection to the Web Mercator tile grid with
bilinear resampling, choosing the COG overview closest to the target resolution. It is a surface
model (DSM). Cells absent from the bucket are ocean by design and are filled with 0 m.
"""

from __future__ import annotations

import asyncio
import math
import os
import time

import numpy as np

from ..config import SourceConfig
from ..logs import log
from ..terrarium import encode_heights
from ..tilemath import ORIGIN_SHIFT, tile_bounds_lonlat, tile_bounds_mercator
from ..upstream import NotFoundUpstream, UnavailableUpstream, UpstreamClient
from .base import TILE_SIZE, AdapterTile, SourceUnavailable, UpstreamAdapter

NATIVE_DEG = 1 / 3600  # 1 arc-second


def cop_cell_name(lat_floor: int, lon_floor: int, res: str = "10") -> str:
    """Cell named by its lower-left corner, e.g. S13_00_W078_00 covers lat -13..-12, lon -78..-77."""
    ns = "N" if lat_floor >= 0 else "S"
    ew = "E" if lon_floor >= 0 else "W"
    return f"Copernicus_DSM_COG_{res}_{ns}{abs(lat_floor):02d}_00_{ew}{abs(lon_floor):03d}_00_DEM"


def _pixel_lonlat(z: int, x: int, y: int) -> tuple[np.ndarray, np.ndarray]:
    w, s, e, n = tile_bounds_mercator(z, x, y)
    step = (e - w) / TILE_SIZE
    mx = w + (np.arange(TILE_SIZE) + 0.5) * step
    my = n - (np.arange(TILE_SIZE) + 0.5) * step
    lon = np.degrees(mx / ORIGIN_SHIFT * math.pi)
    lat = np.degrees(np.arctan(np.sinh(my / ORIGIN_SHIFT * math.pi)))
    return np.broadcast_to(lon[None, :], (TILE_SIZE, TILE_SIZE)), np.broadcast_to(lat[:, None], (TILE_SIZE, TILE_SIZE))


class CopernicusGlo30Adapter(UpstreamAdapter):
    def __init__(self, cfg: SourceConfig, client: UpstreamClient):
        self.source_id = cfg.id
        self.cfg = cfg
        self.client = client
        p = cfg.params
        self.base = str(p.get("url_base", "https://copernicus-dem-30m.s3.amazonaws.com")).rstrip("/")
        self.local = bool(p.get("local", False))
        self.overviews = [int(f) for f in p.get("overviews", [2, 4, 8])]
        self._exists: dict[str, bool] = {}
        self.gdal_env = {
            "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
            "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
            "AWS_NO_SIGN_REQUEST": "YES",
            "GDAL_HTTP_USERAGENT": client.user_agent,
            "GDAL_HTTP_VERSION": "2" if cfg.http2 else "1.1",
            "GDAL_HTTP_MAX_RETRY": str(cfg.reintentos),
            "GDAL_HTTP_RETRY_DELAY": str(cfg.espera_inicial_s),
            "GDAL_HTTP_TIMEOUT": str(int(cfg.timeout_s)),
            "GDAL_HTTP_CONNECTTIMEOUT": str(max(int(cfg.timeout_conexion_s), 1)),
            "GDAL_HTTP_MULTIRANGE": "YES",
            "VSI_CACHE": "TRUE",
            "VSI_CACHE_SIZE": str(64 * 1024 * 1024),
            "GDAL_CACHEMAX": 256,
        }

    def cell_path(self, name: str) -> str:
        if self.local:
            return os.path.join(self.base, name, f"{name}.tif")
        return f"/vsicurl/{self.base}/{name}/{name}.tif"

    async def _cell_exists(self, name: str) -> bool:
        if name in self._exists:
            return self._exists[name]
        if self.local:
            ok = os.path.exists(self.cell_path(name))
        else:
            try:
                await self.client.head(f"{self.base}/{name}/{name}.tif")
                ok = True
            except NotFoundUpstream:
                ok = False
            except UnavailableUpstream as exc:
                raise SourceUnavailable(str(exc)) from exc
        self._exists[name] = ok
        return ok

    def _overview_level(self, target_deg: float) -> int | None:
        level = None
        for i, f in enumerate(self.overviews):
            if f * NATIVE_DEG <= target_deg:
                level = i
        return level

    def _warp_cell(self, name: str, z: int, x: int, y: int) -> np.ndarray:
        import rasterio
        from rasterio.enums import Resampling
        from rasterio.transform import from_bounds
        from rasterio.warp import reproject
        from rasterio.windows import Window, from_bounds as window_from_bounds

        w, s, e, n = tile_bounds_lonlat(z, x, y)
        level = self._overview_level((e - w) / TILE_SIZE)
        dst = np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype=np.float32)
        kwargs = {"overview_level": level} if level is not None else {}
        with rasterio.Env(**self.gdal_env), rasterio.open(self.cell_path(name), **kwargs) as src:
            win = window_from_bounds(w, s, e, n, transform=src.transform)
            col0 = max(int(math.floor(win.col_off)) - 2, 0)
            row0 = max(int(math.floor(win.row_off)) - 2, 0)
            col1 = min(int(math.ceil(win.col_off + win.width)) + 2, src.width)
            row1 = min(int(math.ceil(win.row_off + win.height)) + 2, src.height)
            if col1 <= col0 or row1 <= row0:
                return dst
            window = Window(col0, row0, col1 - col0, row1 - row0)
            data = src.read(1, window=window, out_dtype="float32")
            src_transform = src.window_transform(window)
            if src.nodata is not None:
                data[data == src.nodata] = np.nan
        mw, ms, me, mn = tile_bounds_mercator(z, x, y)
        reproject(data, dst, src_transform=src_transform, src_crs="EPSG:4326",
                  dst_transform=from_bounds(mw, ms, me, mn, TILE_SIZE, TILE_SIZE), dst_crs="EPSG:3857",
                  resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
        return dst

    async def _read_cell(self, name: str, z: int, x: int, y: int) -> np.ndarray:
        last: Exception | None = None
        for attempt in range(self.cfg.reintentos + 1):
            started = time.monotonic()
            try:
                async with self.client.slot():
                    part = await asyncio.to_thread(self._warp_cell, name, z, x, y)
                self.client.metrics.upstream_requests.labels(source=self.source_id, status="cog").inc()
                self.client.budget.add(1, 0)
                self.client._alive()
                return part
            except UnavailableUpstream as exc:
                raise SourceUnavailable(str(exc)) from exc
            except Exception as exc:  # rasterio/GDAL I/O errors
                last = exc
                self.client._failed(started)
                self.client.metrics.upstream_errors.labels(source=self.source_id).inc()
                if attempt < self.cfg.reintentos:
                    await asyncio.sleep(self.cfg.espera_inicial_s * 2**attempt)
        log.warning("lectura COG fallida", extra={"evento": "fuente_error", "fuente": self.source_id, "celda": name,
                                                  "detalle": f"{type(last).__name__}: {last}"[:300]})
        raise SourceUnavailable(f"lectura COG fallida: {type(last).__name__}")

    async def fetch(self, z: int, x: int, y: int, max_real_zoom: int) -> AdapterTile:
        lon, lat = _pixel_lonlat(z, x, y)
        lat_cells = np.floor(lat[:, 0]).astype(int)
        lon_cells = np.floor(lon[0, :]).astype(int)
        cells = sorted({(la, lo) for la in set(lat_cells.tolist()) for lo in set(lon_cells.tolist())})
        exists = await asyncio.gather(*(self._cell_exists(cop_cell_name(la, lo)) for la, lo in cells))
        present = [c for c, ok in zip(cells, exists) if ok]
        heights = np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype=np.float32)
        parts = await asyncio.gather(*(self._read_cell(cop_cell_name(la, lo), z, x, y) for la, lo in present))
        for part in parts:
            heights = np.where(np.isnan(heights), part, heights)
        missing = set(cells) - set(present)
        if missing:
            ocean = np.zeros((TILE_SIZE, TILE_SIZE), dtype=bool)
            cell_lat = np.floor(lat).astype(int)
            cell_lon = np.floor(lon).astype(int)
            for la, lo in missing:
                ocean |= (cell_lat == la) & (cell_lon == lo)
            heights[ocean & np.isnan(heights)] = 0.0
        if np.isnan(heights).any() and not np.isnan(heights).all():
            from rasterio.fill import fillnodata

            mask = (~np.isnan(heights)).astype(np.uint8)
            reached = fillnodata(mask.astype(np.float32), mask=mask, max_search_distance=4) > 0.5
            heights = fillnodata(np.nan_to_num(heights, nan=0.0), mask=mask, max_search_distance=4)
            heights[~reached] = np.nan  # seams are filled; wider gaps stay nodata
        return AdapterTile(rgb=encode_heights(heights), overzoom=z > max_real_zoom,
                           upstream={"celdas": [cop_cell_name(la, lo) for la, lo in present], "modelo": "DSM"})
