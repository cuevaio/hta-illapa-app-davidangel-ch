import math

import numpy as np
import pytest

from weather_service.decode import decode_message
from weather_service.encoding import NODATA, decode_uint16, encode_uint16
from weather_service.grid import (
    LatLonGrid,
    MercatorGrid,
    lonlat_to_mercator,
    mercator_to_lonlat,
    resample_bilinear,
    resample_to_mercator,
    sample_mercator_grid,
)
from weather_service.products import kelvin_to_celsius

from .conftest import synthetic_field


def test_mercator_known_points():
    x, y = lonlat_to_mercator(180.0, 0.0)
    assert x == pytest.approx(math.pi * 6378137.0)
    assert y == pytest.approx(0.0, abs=1e-6)
    lon, lat = mercator_to_lonlat(*lonlat_to_mercator(-77.04, -12.05))
    assert (float(lon), float(lat)) == pytest.approx((-77.04, -12.05))


def test_peru_grid_is_tiles_bbox_plus_margin():
    # Default bbox = services/tiles PERU_BBOX (-81.5, -18.5, -68.5, 0.2) plus a 2 deg margin.
    g = MercatorGrid.peru(256, 2.0)
    b = g.lonlat_bounds()
    assert (b["west"], b["south"], b["east"], b["north"]) == pytest.approx((-83.5, -20.5, -66.5, 2.2))
    assert g.height == round(256 * (g.max_y - g.min_y) / (g.max_x - g.min_x))


def test_reference_bounds_still_reproduce_the_cloud_sample_extent():
    # peru-simulator PERU_BOUNDS + 2 deg = extent of the committed sample (services/weather/sample).
    g = MercatorGrid.peru(256, 2.0, (-81.4, -18.4, -68.6, 0.0))
    assert g.min_x == pytest.approx(-9284045.532159016)
    assert g.max_y == pytest.approx(222684.20850554318)


def test_resample_reproduces_a_linear_field_with_longitude_wrap():
    step = 0.25
    src = LatLonGrid(lat0=90.0, lon0=0.0, dlat=-step, dlon=step, nj=721, ni=1440)
    lats = 90.0 - np.arange(721) * step
    lons = np.arange(1440) * step
    lon2, lat2 = np.meshgrid(lons, lats)
    values = synthetic_field(lon2, lat2)
    # Negative (western) longitudes map onto 0..360 source columns.
    out = resample_bilinear(values, src, [-77.04, -70.02], [-12.05, -15.84])
    assert out == pytest.approx(synthetic_field(np.array([-77.04, -70.02]), np.array([-12.05, -15.84])), abs=1e-9)


def test_resample_outside_regional_source_is_nan():
    src = LatLonGrid(lat0=0.0, lon0=-80.0, dlat=-1.0, dlon=1.0, nj=3, ni=3)
    out = resample_bilinear(np.ones((3, 3)), src, [-79.5, -90.0], [-0.5, -0.5])
    assert out[0] == 1.0 and np.isnan(out[1])


def test_mercator_grid_pixel_centers_and_point_query(grib_message):
    grid = MercatorGrid.from_lonlat(-81.0, -18.0, -69.0, 0.0, 64)
    field = decode_message(grib_message)
    out = resample_to_mercator(field.values, field.grid, grid)
    assert out.shape == (grid.height, grid.width) and out.dtype == np.float32
    lon, lat = grid.pixel_centers_lonlat()
    # Row 0 is the north edge.
    assert lat[0, 0] > lat[-1, 0] and lon[0, 0] < lon[0, -1]
    expected = synthetic_field(-77.04, -12.05)
    # 16-bit GRIB packing of the synthetic field: ~2 mK resolution.
    assert sample_mercator_grid(out, grid, -77.04, -12.05) == pytest.approx(expected, abs=0.02)
    assert sample_mercator_grid(out, grid, -60.0, -12.0) is None


def test_decode_message_geometry(grib_message):
    f = decode_message(grib_message)
    assert f.values.shape == (181, 360)
    assert (f.grid.lat0, f.grid.lon0, f.grid.dlat, f.grid.dlon) == (90.0, 0.0, -1.0, 1.0)
    assert f.values[0, 280] == pytest.approx(synthetic_field(280.0, 90.0), abs=0.02)


def test_kelvin_to_celsius():
    assert kelvin_to_celsius(np.array([273.15, 300.0])) == pytest.approx([0.0, 26.85])


def test_uint16_encoding_round_trip_with_nodata():
    values = np.array([[-5.0, 12.25], [np.nan, 31.5]], dtype=np.float32)
    data, meta = encode_uint16(values)
    assert len(data) == 8 and meta["nodata"] == NODATA
    assert (meta["min"], meta["max"]) == (-5.0, 31.5)
    out = decode_uint16(data, meta, (2, 2))
    assert np.isnan(out[1, 0])
    assert out[~np.isnan(out)] == pytest.approx([-5.0, 12.25, 31.5], abs=meta["scale"])


def test_uint16_encoding_constant_and_empty():
    _, meta = encode_uint16(np.full((2, 2), 7.0))
    assert meta["scale"] == 1.0 and meta["offset"] == 7.0
    _, meta = encode_uint16(np.full((2, 2), np.nan))
    assert meta["min"] is None
