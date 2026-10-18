import numpy as np
import pytest

from weather_service.clouds import cloud_style as cs
from weather_service.clouds import goes_projection as gp
from weather_service.clouds.pipeline import parse_scan_start


def test_pug_reference_point_round_trip():
    # GOES-R PUG vol 3 §4.2.8.1 worked example (GOES-East, 75.0 W).
    lon, lat = gp.scan_to_lonlat(gp.GOES_EAST, -0.024052, 0.095340)
    assert lat == pytest.approx(33.846162, abs=1e-4)
    assert lon == pytest.approx(-84.690932, abs=1e-4)
    x, y, visible = gp.lonlat_to_scan(gp.GOES_EAST, -84.690932, 33.846162)
    assert bool(visible)
    assert x == pytest.approx(-0.024052, abs=1e-6)
    assert y == pytest.approx(0.095340, abs=1e-6)


def test_subsatellite_point_maps_to_origin_and_far_side_is_hidden():
    x, y, visible = gp.lonlat_to_scan(gp.GOES_EAST, -75.0, 0.0)
    assert abs(x) < 1e-12 and abs(y) < 1e-12 and bool(visible)
    _, _, hidden = gp.lonlat_to_scan(gp.GOES_EAST, 105.0, 0.0)
    assert not bool(hidden)


def test_lima_lies_south_and_slightly_east_of_nadir():
    x, y, _ = gp.lonlat_to_scan(gp.GOES_EAST, -77.0428, -12.0464)
    assert x < 0  # west of the 75 W sub-satellite meridian
    assert y < 0  # southern hemisphere
    lon, lat = gp.scan_to_lonlat(gp.GOES_EAST, x, y)
    assert lon == pytest.approx(-77.0428, abs=1e-7)
    assert lat == pytest.approx(-12.0464, abs=1e-7)


def test_mercator_grid_is_north_up_and_covers_bounds():
    grid = gp.MercatorGrid.from_lonlat(-80, -20, -70, 0, 100)
    lon, lat = grid.pixel_centers_lonlat()
    assert lon.shape == (grid.height, 100)
    assert lat[0, 0] > lat[-1, 0]
    assert lon[0, 0] < lon[0, -1]
    assert -80 < lon.min() < -79.9 and -70.1 < lon.max() < -70


def test_probability_ramp_is_monotonic_and_clamped():
    p = np.array([0.0, cs.PROBABILITY_LOW, 0.6, cs.PROBABILITY_HIGH, 1.0, np.nan])
    o = cs.probability_opacity(p)
    assert o[0] == 0 and o[1] == 0 and o[3] == 1 and o[4] == 1 and o[5] == 0
    assert 0 < o[2] < 1


def test_acm_levels_map_to_graded_opacity_and_invalid_to_zero():
    assert cs.acm_opacity(np.array([0, 1, 2, 3, 255])).tolist() == [0.0, 0.15, 0.6, 1.0, 0.0]


def test_cold_tops_are_brighter_and_more_opaque_than_warm_low_cloud():
    lum, alpha = cs.compose(np.array([1.0, 1.0, 0.0]), cs.ir_coldness(np.array([280.0, 210.0, 210.0])))
    assert lum[1] > lum[0] and alpha[1] > alpha[0]
    assert alpha[0] >= cs.LOW_CLOUD_OPACITY - 1e-9
    assert alpha[2] == 0  # no cloud in the mask means transparent, however cold


def test_compose_without_ir_uses_mask_only():
    lum, alpha = cs.compose(np.array([0.0, 1.0]))
    assert alpha.tolist() == [0.0, 0.85] and lum[1] == pytest.approx(1.0)


def test_gaussian_blur_preserves_mass_and_softens_edges():
    a = np.zeros((21, 21))
    a[10, 10] = 1.0
    b = cs.gaussian_blur(a, 1.5)
    assert b.sum() == pytest.approx(1.0)
    assert b[10, 10] < 1 and b[10, 12] > 0


def test_bilinear_interpolates_and_marks_outside_nan():
    slab = np.array([[0.0, 10.0], [20.0, 30.0]])
    out = cs.bilinear(slab, np.array([0.5, 0.0, 2.0]), np.array([0.5, 1.0, 0.0]))
    assert out[0] == pytest.approx(15.0) and out[1] == pytest.approx(20.0)
    assert np.isnan(out[2])


def test_parse_scan_start_from_goes_filename():
    key = "ABI-L2-ACMF/2026/290/22/OR_ABI-L2-ACMF-M6_G19_s20262902250207_e20262902259515_c20262902300182.nc"
    assert parse_scan_start(key) == "2026-10-17T22:50:20.7Z"
