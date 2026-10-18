"""Web Mercator output grids over Peru and resampling from regular lat/lon grids.

The grid geometry is shared with the GOES-19 cloud product: the configured Peru
bbox (default: services/tiles PERU_BBOX) plus a margin in degrees, row 0 at the
north edge, pixel centers at (i + 0.5) / size.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

EARTH_RADIUS = 6378137.0
MAX_MERCATOR_LAT = 85.0511287798066
#: Same bbox as services/tiles (tiles_service.config.PERU_BBOX): west, south, east, north.
PERU_BBOX = (-81.5, -18.5, -68.5, 0.2)


def lonlat_to_mercator(lon, lat):
    lat = np.clip(np.asarray(lat, dtype=np.float64), -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)
    x = EARTH_RADIUS * np.radians(np.asarray(lon, dtype=np.float64))
    y = EARTH_RADIUS * np.log(np.tan(math.pi / 4 + np.radians(lat) / 2))
    return x, y


def mercator_to_lonlat(x, y):
    lon = np.degrees(np.asarray(x, dtype=np.float64) / EARTH_RADIUS)
    lat = np.degrees(2 * np.arctan(np.exp(np.asarray(y, dtype=np.float64) / EARTH_RADIUS)) - math.pi / 2)
    return lon, lat


@dataclass(frozen=True)
class MercatorGrid:
    """Output raster in Web Mercator (EPSG:3857); row 0 is the north edge."""

    min_x: float
    min_y: float
    max_x: float
    max_y: float
    width: int
    height: int

    @staticmethod
    def from_lonlat(west: float, south: float, east: float, north: float, width: int) -> "MercatorGrid":
        min_x, min_y = lonlat_to_mercator(west, south)
        max_x, max_y = lonlat_to_mercator(east, north)
        height = int(round(width * (max_y - min_y) / (max_x - min_x)))
        return MercatorGrid(float(min_x), float(min_y), float(max_x), float(max_y), width, height)

    @staticmethod
    def peru(width: int, margin: float, bbox: tuple[float, float, float, float] = PERU_BBOX) -> "MercatorGrid":
        w, s, e, n = bbox
        return MercatorGrid.from_lonlat(w - margin, s - margin, e + margin, n + margin, width)

    def pixel_centers_lonlat(self):
        """(lon, lat) arrays of shape (height, width) for every pixel center."""
        dx = (self.max_x - self.min_x) / self.width
        dy = (self.max_y - self.min_y) / self.height
        xs = self.min_x + (np.arange(self.width) + 0.5) * dx
        ys = self.max_y - (np.arange(self.height) + 0.5) * dy
        mx, my = np.meshgrid(xs, ys)
        return mercator_to_lonlat(mx, my)

    def mercator_bounds(self) -> dict[str, float]:
        return {"minX": self.min_x, "minY": self.min_y, "maxX": self.max_x, "maxY": self.max_y}

    def lonlat_bounds(self) -> dict[str, float]:
        (west, east), (south, north) = mercator_to_lonlat([self.min_x, self.max_x], [self.min_y, self.max_y])
        return {"west": float(west), "south": float(south), "east": float(east), "north": float(north)}


@dataclass(frozen=True)
class LatLonGrid:
    """Regular lat/lon source grid: value[j, i] at (lat0 + j * dlat, lon0 + i * dlon)."""

    lat0: float
    lon0: float
    dlat: float
    dlon: float
    nj: int
    ni: int

    @property
    def is_global_lon(self) -> bool:
        return abs(self.ni * self.dlon - 360.0) < 1e-6


def resample_bilinear(values: np.ndarray, src: LatLonGrid, lon, lat) -> np.ndarray:
    """Bilinear sample of a lat/lon grid at arbitrary points; NaN outside the source."""
    lon = np.asarray(lon, dtype=np.float64)
    lat = np.asarray(lat, dtype=np.float64)
    fi = ((lon - src.lon0) % 360.0) / src.dlon if src.is_global_lon else (lon - src.lon0) / src.dlon
    fj = (lat - src.lat0) / src.dlat
    i0 = np.floor(fi).astype(np.int64)
    j0 = np.floor(fj).astype(np.int64)
    ti = fi - i0
    tj = fj - j0
    if src.is_global_lon:
        i0 %= src.ni
        i1 = (i0 + 1) % src.ni
        valid_i = np.ones_like(i0, dtype=bool)
    else:
        i1 = i0 + 1
        valid_i = (i0 >= 0) & (i1 < src.ni)
    j1 = j0 + 1
    valid = valid_i & (j0 >= 0) & (j1 < src.nj)
    i0c, i1c = np.clip(i0, 0, src.ni - 1), np.clip(i1, 0, src.ni - 1)
    j0c, j1c = np.clip(j0, 0, src.nj - 1), np.clip(j1, 0, src.nj - 1)
    v00 = values[j0c, i0c]
    v01 = values[j0c, i1c]
    v10 = values[j1c, i0c]
    v11 = values[j1c, i1c]
    out = (v00 * (1 - ti) + v01 * ti) * (1 - tj) + (v10 * (1 - ti) + v11 * ti) * tj
    return np.where(valid, out, np.nan)


def resample_to_mercator(values: np.ndarray, src: LatLonGrid, grid: MercatorGrid) -> np.ndarray:
    lon, lat = grid.pixel_centers_lonlat()
    return resample_bilinear(values, src, lon, lat).astype(np.float32)


def sample_mercator_grid(values: np.ndarray, grid: MercatorGrid, lon: float, lat: float) -> float | None:
    """Bilinear point query in a mercator grid (pixel centers); None outside or on nodata."""
    mx, my = lonlat_to_mercator(lon, lat)
    fx = (float(mx) - grid.min_x) / (grid.max_x - grid.min_x) * grid.width - 0.5
    fy = (grid.max_y - float(my)) / (grid.max_y - grid.min_y) * grid.height - 0.5
    if fx < -0.5 or fy < -0.5 or fx > grid.width - 0.5 or fy > grid.height - 0.5:
        return None
    fx = min(max(fx, 0.0), grid.width - 1.0)
    fy = min(max(fy, 0.0), grid.height - 1.0)
    x0, y0 = int(math.floor(fx)), int(math.floor(fy))
    x1, y1 = min(x0 + 1, grid.width - 1), min(y0 + 1, grid.height - 1)
    tx, ty = fx - x0, fy - y0
    v = (values[y0, x0] * (1 - tx) + values[y0, x1] * tx) * (1 - ty) + (
        values[y1, x0] * (1 - tx) + values[y1, x1] * tx
    ) * ty
    return None if not np.isfinite(v) else float(v)
