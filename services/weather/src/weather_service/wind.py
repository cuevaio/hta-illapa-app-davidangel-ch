"""Wind vector math. Grid components follow GRIB: u > 0 blows toward the east, v > 0 toward the north."""

from __future__ import annotations

import numpy as np

COMPASS_16 = ("N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW")


def wind_speed(u, v):
    return np.hypot(u, v)


def wind_direction_from(u, v):
    """Meteorological direction in degrees (0 = from the north, 90 = from the east), [0, 360)."""
    deg = np.degrees(np.arctan2(-np.asarray(u, dtype=np.float64), -np.asarray(v, dtype=np.float64))) % 360.0
    return float(deg) if np.ndim(deg) == 0 else deg


def ms_to_kmh(speed):
    return speed * 3.6


def compass_label(direction_deg: float) -> str:
    """16-point compass label; each sector spans 22.5° centered on its direction."""
    return COMPASS_16[int(((direction_deg % 360.0) + 11.25) // 22.5) % 16]
