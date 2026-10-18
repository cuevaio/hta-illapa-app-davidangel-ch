"""Terrain Tiles on AWS (`elevation-tiles-prod`), Terrarium 256 px -> internal 512 px.

z <= max_real_zoom: stitch the four 256 px children z+1 (RGB copied byte-for-byte, no re-quantisation).
z  > max_real_zoom: crop the 256 px tile at max_real_zoom+1 that contains the extent and upsample
bilinearly in metres (overzoom, flagged). Never uses source levels above the real zoom.
"""

from __future__ import annotations

import asyncio

import numpy as np

from ..config import SourceConfig
from ..terrarium import decode_rgb, encode_heights, png_to_rgb
from ..upstream import NotFoundUpstream, UnavailableUpstream, UpstreamClient
from .base import TILE_SIZE, AdapterTile, SourceUnavailable, TileNotFound, UpstreamAdapter


def upsample_bilinear(heights: np.ndarray, out: int, x0: float, y0: float, size: float) -> np.ndarray:
    """Sample `heights` (H, W) over the square window [x0, x0+size) x [y0, y0+size) at out x out pixel centres."""
    h, w = heights.shape
    coords = x0 + (np.arange(out) + 0.5) * size / out - 0.5
    rows = y0 + (np.arange(out) + 0.5) * size / out - 0.5
    cx = np.clip(coords, 0, w - 1)
    ry = np.clip(rows, 0, h - 1)
    c0 = np.floor(cx).astype(int)
    r0 = np.floor(ry).astype(int)
    c1 = np.minimum(c0 + 1, w - 1)
    r1 = np.minimum(r0 + 1, h - 1)
    fx = (cx - c0)[None, :]
    fy = (ry - r0)[:, None]
    a = heights[np.ix_(r0, c0)]
    b = heights[np.ix_(r0, c1)]
    c = heights[np.ix_(r1, c0)]
    d = heights[np.ix_(r1, c1)]
    top = a * (1 - fx) + b * fx
    bottom = c * (1 - fx) + d * fx
    result = top * (1 - fy) + bottom * fy
    # nodata stays nodata: any NaN neighbour -> take the nearest sample instead of mixing
    nearest = heights[np.ix_(np.clip(np.rint(ry).astype(int), 0, h - 1), np.clip(np.rint(cx).astype(int), 0, w - 1))]
    return np.where(np.isnan(result), nearest, result)


class TerrainTilesAdapter(UpstreamAdapter):
    def __init__(self, cfg: SourceConfig, client: UpstreamClient):
        self.source_id = cfg.id
        self.cfg = cfg
        self.client = client
        self.base = str(cfg.params.get("url_base", "https://elevation-tiles-prod.s3.amazonaws.com")).rstrip("/")
        self.max_source_zoom = int(cfg.params.get("zoom_max_fuente", 15))

    def url(self, z: int, x: int, y: int) -> str:
        return f"{self.base}/terrarium/{z}/{x}/{y}.png"

    async def _child(self, z: int, x: int, y: int) -> tuple[np.ndarray | None, dict]:
        try:
            resp = await self.client.get(self.url(z, x, y))
        except NotFoundUpstream:
            return None, {}
        except UnavailableUpstream as exc:
            raise SourceUnavailable(str(exc)) from exc
        try:
            rgb = png_to_rgb(resp.content)
        except Exception as exc:  # corrupt payload: treat as a source failure, not as absent data
            raise SourceUnavailable("respuesta PNG inválida") from exc
        if rgb.shape != (256, 256, 3):
            raise SourceUnavailable(f"tamaño inesperado {rgb.shape}")
        meta = {k: resp.headers[h] for k, h in (("ultima_modificacion", "last-modified"),
                                                ("fuentes_imagen", "x-amz-meta-x-imagery-sources")) if h in resp.headers}
        return rgb, meta

    async def fetch(self, z: int, x: int, y: int, max_real_zoom: int) -> AdapterTile:
        if z <= max_real_zoom:
            return await self._stitch(z, x, y)
        return await self._overzoom(z, x, y, max_real_zoom)

    async def _stitch(self, z: int, x: int, y: int) -> AdapterTile:
        children = [(2 * x + dx, 2 * y + dy, dx, dy) for dy in (0, 1) for dx in (0, 1)]
        results = await asyncio.gather(*(self._child(z + 1, cx, cy) for cx, cy, _, _ in children))
        if all(rgb is None for rgb, _ in results):
            raise TileNotFound(f"terrarium {z + 1} sin datos")
        out = np.zeros((TILE_SIZE, TILE_SIZE, 3), dtype=np.uint8)  # missing child -> nodata (0,0,0)
        meta: dict = {}
        for (_, _, dx, dy), (rgb, m) in zip(children, results):
            if rgb is not None:
                out[dy * 256:(dy + 1) * 256, dx * 256:(dx + 1) * 256] = rgb
                meta.update(m)
        return AdapterTile(rgb=out, overzoom=False, upstream=meta)

    async def _overzoom(self, z: int, x: int, y: int, max_real_zoom: int) -> AdapterTile:
        src_z = max_real_zoom + 1  # 256 px source level with real data
        shift = z - src_z
        if shift < 0:  # z == max_real_zoom + 1 -> exactly one source tile
            shift = 0
        sx, sy = x >> shift, y >> shift
        size = 256 / (2**shift)
        x0 = (x - (sx << shift)) * size
        y0 = (y - (sy << shift)) * size
        rgb, meta = await self._child(src_z, sx, sy)
        if rgb is None:
            raise TileNotFound(f"terrarium {src_z} sin datos")
        heights = decode_rgb(rgb)
        up = upsample_bilinear(heights, TILE_SIZE, x0, y0, size)
        return AdapterTile(rgb=encode_heights(up), overzoom=True, upstream=meta)
