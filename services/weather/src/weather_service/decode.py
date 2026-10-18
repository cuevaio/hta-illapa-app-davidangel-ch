"""GRIB2 decoding with ecCodes (binary wheels: eccodes + eccodeslib)."""

from __future__ import annotations

from dataclasses import dataclass

import eccodes
import numpy as np

from .grid import LatLonGrid


@dataclass(frozen=True)
class DecodedField:
    values: np.ndarray  # (nj, ni) float64, NaN where missing
    grid: LatLonGrid
    short_name: str
    units: str


def decode_message(data: bytes) -> DecodedField:
    """Decodes exactly one GRIB2 message on a regular lat/lon grid."""
    handle = eccodes.codes_new_from_message(data)
    try:
        grid_type = eccodes.codes_get(handle, "gridType")
        if grid_type != "regular_ll":
            raise ValueError(f"unsupported grid type {grid_type}")
        ni = int(eccodes.codes_get(handle, "Ni"))
        nj = int(eccodes.codes_get(handle, "Nj"))
        lat0 = float(eccodes.codes_get(handle, "latitudeOfFirstGridPointInDegrees"))
        lon0 = float(eccodes.codes_get(handle, "longitudeOfFirstGridPointInDegrees"))
        di = float(eccodes.codes_get(handle, "iDirectionIncrementInDegrees"))
        dj = float(eccodes.codes_get(handle, "jDirectionIncrementInDegrees"))
        if int(eccodes.codes_get(handle, "iScansNegatively")):
            raise ValueError("iScansNegatively grids are not supported")
        dlat = dj if int(eccodes.codes_get(handle, "jScansPositively")) else -dj
        values = np.asarray(eccodes.codes_get_values(handle), dtype=np.float64)
        if int(eccodes.codes_get(handle, "bitmapPresent")):
            missing = float(eccodes.codes_get(handle, "missingValue"))
            values[values == missing] = np.nan
        short_name = str(eccodes.codes_get(handle, "shortName"))
        units = str(eccodes.codes_get(handle, "units"))
    finally:
        eccodes.codes_release(handle)
    if values.size != ni * nj:
        raise ValueError(f"value count {values.size} != {ni}x{nj}")
    return DecodedField(values.reshape(nj, ni), LatLonGrid(lat0, lon0 % 360.0, dlat, di, nj, ni), short_name, units)
