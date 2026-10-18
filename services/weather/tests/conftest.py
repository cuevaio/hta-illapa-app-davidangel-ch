from __future__ import annotations

import datetime as dt

import eccodes
import numpy as np
import pytest


def synthetic_field(lon, lat) -> np.ndarray:
    """Kelvin field linear in lon/lat, so bilinear resampling reproduces it exactly."""
    return 273.15 + 20.0 + 0.5 * np.asarray(lat) - 0.1 * (np.asarray(lon) % 360.0 - 280.0)


def make_grib(values_fn=synthetic_field, step: float = 1.0) -> bytes:
    """Global regular lat/lon GRIB2 message (north to south, 0..360 east) like GFS 0.25."""
    ni, nj = int(round(360 / step)), int(round(180 / step)) + 1
    lats = 90.0 - np.arange(nj) * step
    lons = np.arange(ni) * step
    lon2, lat2 = np.meshgrid(lons, lats)
    h = eccodes.codes_grib_new_from_samples("regular_ll_sfc_grib2")
    try:
        eccodes.codes_set(h, "Ni", ni)
        eccodes.codes_set(h, "Nj", nj)
        eccodes.codes_set(h, "latitudeOfFirstGridPointInDegrees", 90.0)
        eccodes.codes_set(h, "longitudeOfFirstGridPointInDegrees", 0.0)
        eccodes.codes_set(h, "latitudeOfLastGridPointInDegrees", -90.0)
        eccodes.codes_set(h, "longitudeOfLastGridPointInDegrees", 360.0 - step)
        eccodes.codes_set(h, "iDirectionIncrementInDegrees", step)
        eccodes.codes_set(h, "jDirectionIncrementInDegrees", step)
        eccodes.codes_set(h, "bitsPerValue", 16)
        eccodes.codes_set_values(h, values_fn(lon2, lat2).ravel())
        return eccodes.codes_get_message(h)
    finally:
        eccodes.codes_release(h)


@pytest.fixture(scope="session")
def grib_message() -> bytes:
    return make_grib()


class FakeClock:
    def __init__(self, now: dt.datetime) -> None:
        self.now = now

    def __call__(self) -> dt.datetime:
        return self.now
