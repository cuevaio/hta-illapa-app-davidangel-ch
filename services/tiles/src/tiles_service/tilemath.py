"""XYZ / Web Mercator helpers (y grows southwards)."""

from __future__ import annotations

import math
from collections.abc import Iterator

ORIGIN_SHIFT = 20037508.342789244  # metres, half the Web Mercator world width


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    lat_r = math.radians(max(min(lat, 85.0511287798), -85.0511287798))
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def tile_lon(x: float, z: int) -> float:
    return x / 2**z * 360.0 - 180.0


def tile_lat(y: float, z: int) -> float:
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2**z))))


def tile_bounds_lonlat(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """(west, south, east, north) in degrees."""
    return tile_lon(x, z), tile_lat(y + 1, z), tile_lon(x + 1, z), tile_lat(y, z)


def tile_bounds_mercator(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    size = 2 * ORIGIN_SHIFT / 2**z
    west = -ORIGIN_SHIFT + x * size
    north = ORIGIN_SHIFT - y * size
    return west, north - size, west + size, north


def intersects(bounds: tuple[float, float, float, float], bbox: tuple[float, float, float, float]) -> bool:
    w, s, e, n = bounds
    bw, bs, be, bn = bbox
    return w < be and e > bw and s < bn and n > bs


def tiles_in_bbox(z: int, bbox: tuple[float, float, float, float]) -> Iterator[tuple[int, int]]:
    w, s, e, n = bbox
    x0, y0 = lonlat_to_tile(w, n, z)
    x1, y1 = lonlat_to_tile(e, s, z)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            if intersects(tile_bounds_lonlat(z, x, y), bbox):
                yield x, y


def meters_per_pixel(lat: float, z: int, tile_size: int = 512) -> float:
    return 2 * ORIGIN_SHIFT * math.cos(math.radians(lat)) / (tile_size * 2**z)
