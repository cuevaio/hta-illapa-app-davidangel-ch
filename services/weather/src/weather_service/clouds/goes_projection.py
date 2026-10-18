"""GOES-R ABI fixed-grid geostationary projection and Web Mercator helpers.

Formulas follow the GOES-R Product User Guide (PUG) L1b/L2+ volume 3,
section 4.2.8 ("ABI fixed grid"). Scan angles x (east-west) and y
(north-south) are in radians; the sweep angle axis is x.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

EARTH_RADIUS_MERCATOR = 6378137.0


@dataclass(frozen=True)
class GoesProjection:
    """Attributes of the `goes_imager_projection` variable."""

    perspective_point_height: float
    semi_major_axis: float
    semi_minor_axis: float
    longitude_of_projection_origin: float

    @property
    def h(self) -> float:
        """Distance from the Earth center to the satellite, in meters."""
        return self.perspective_point_height + self.semi_major_axis


# Nominal GOES-East parameters (GOES-16/19 at 75.0 W), used by tests and as a reference.
GOES_EAST = GoesProjection(35786023.0, 6378137.0, 6356752.31414, -75.0)


def lonlat_to_scan(proj: GoesProjection, lon_deg, lat_deg):
    """Geodetic lon/lat (degrees) -> scan angles (x, y) in radians plus a visibility mask."""
    req = proj.semi_major_axis
    rpol = proj.semi_minor_axis
    h = proj.h
    lam = np.radians(np.asarray(lon_deg, dtype=np.float64))
    phi = np.radians(np.asarray(lat_deg, dtype=np.float64))
    lam0 = np.radians(proj.longitude_of_projection_origin)
    e2 = (req * req - rpol * rpol) / (req * req)
    phi_c = np.arctan((rpol * rpol) / (req * req) * np.tan(phi))
    rc = rpol / np.sqrt(1.0 - e2 * np.cos(phi_c) ** 2)
    sx = h - rc * np.cos(phi_c) * np.cos(lam - lam0)
    sy = -rc * np.cos(phi_c) * np.sin(lam - lam0)
    sz = rc * np.sin(phi_c)
    # Points on the far side of the Earth are hidden from the satellite.
    visible = h * (h - sx) >= sy * sy + (req * req) / (rpol * rpol) * sz * sz
    x = np.arcsin(-sy / np.sqrt(sx * sx + sy * sy + sz * sz))
    y = np.arctan(sz / sx)
    return x, y, visible


def scan_to_lonlat(proj: GoesProjection, x, y):
    """Scan angles (radians) -> geodetic lon/lat in degrees (NaN off the Earth disk)."""
    req = proj.semi_major_axis
    rpol = proj.semi_minor_axis
    h = proj.h
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    a = np.sin(x) ** 2 + np.cos(x) ** 2 * (np.cos(y) ** 2 + (req * req) / (rpol * rpol) * np.sin(y) ** 2)
    b = -2.0 * h * np.cos(x) * np.cos(y)
    c = h * h - req * req
    disc = b * b - 4.0 * a * c
    with np.errstate(invalid="ignore"):
        rs = (-b - np.sqrt(disc)) / (2.0 * a)
    sx = rs * np.cos(x) * np.cos(y)
    sy = -rs * np.sin(x)
    sz = rs * np.cos(x) * np.sin(y)
    lat = np.degrees(np.arctan((req * req) / (rpol * rpol) * sz / np.sqrt((h - sx) ** 2 + sy * sy)))
    lon = proj.longitude_of_projection_origin - np.degrees(np.arctan(sy / (h - sx)))
    return lon, lat


def lonlat_to_mercator(lon_deg, lat_deg):
    lon = np.asarray(lon_deg, dtype=np.float64)
    lat = np.asarray(lat_deg, dtype=np.float64)
    x = EARTH_RADIUS_MERCATOR * np.radians(lon)
    y = EARTH_RADIUS_MERCATOR * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
    return x, y


def mercator_to_lonlat(x, y):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    lon = np.degrees(x / EARTH_RADIUS_MERCATOR)
    lat = np.degrees(2 * np.arctan(np.exp(y / EARTH_RADIUS_MERCATOR)) - np.pi / 2)
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

    def pixel_centers_lonlat(self):
        """(lon, lat) arrays of shape (height, width) for every pixel center."""
        dx = (self.max_x - self.min_x) / self.width
        dy = (self.max_y - self.min_y) / self.height
        xs = self.min_x + (np.arange(self.width) + 0.5) * dx
        ys = self.max_y - (np.arange(self.height) + 0.5) * dy
        mx, my = np.meshgrid(xs, ys)
        return mercator_to_lonlat(mx, my)


@dataclass(frozen=True)
class FixedGridAxis:
    """Decoded scan-angle axis: angle(i) = start + i * step (radians)."""

    start: float
    step: float

    def index_of(self, angle):
        return (np.asarray(angle, dtype=np.float64) - self.start) / self.step
