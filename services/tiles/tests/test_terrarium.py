"""Internal height format: Terrarium RGB, explicit formula, consistent nodata."""

from __future__ import annotations

import numpy as np

from tiles_service.terrarium import (
    NODATA_RGB,
    decode_png,
    decode_rgb,
    encode_heights,
    encode_png,
    height_stats,
)


def test_round_trip_recovers_heights_within_expected_error():
    rng = np.random.default_rng(42)
    heights = rng.uniform(-500.0, 6900.0, size=(512, 512)).astype(np.float64)
    heights[0, :4] = [0.0, 6768.0, -432.7, 3812.004]
    decoded = decode_png(encode_png(encode_heights(heights)))
    assert decoded.shape == (512, 512)
    # quantisation step of the blue channel is 1/256 m -> rounding error <= 1/512 m
    assert np.max(np.abs(decoded - heights)) <= 1 / 512 + 1e-6


def test_formula_matches_documented_terrarium():
    rgb = np.array([[[128, 0, 0], [129, 44, 128], [127, 255, 0]]], dtype=np.uint8)
    h = decode_rgb(rgb)
    assert h[0, 0] == 0.0
    assert h[0, 1] == 256 + 44 + 0.5  # R*256 + G + B/256 - 32768
    assert h[0, 2] == -1.0


def test_nodata_is_consistent():
    heights = np.array([[np.nan, 10.0], [-40000.0, 100.0]])
    rgb = encode_heights(heights)
    assert tuple(rgb[0, 0]) == NODATA_RGB == (0, 0, 0)
    decoded = decode_rgb(rgb)
    assert np.isnan(decoded[0, 0])
    # values below the representable range are clamped, never confused with nodata
    assert not np.isnan(decoded[1, 0])
    # any pixel that decodes to <= -32767 m is nodata
    assert np.isnan(decode_rgb(np.array([[[0, 0, 200]]], dtype=np.uint8))[0, 0])
    assert height_stats(encode_heights(np.array([[np.nan, 10.0], [np.nan, 100.0]]))) == (10.0, 100.0)


def test_stats_of_all_nodata_tile_are_none():
    rgb = np.zeros((4, 4, 3), dtype=np.uint8)
    assert height_stats(rgb) == (None, None)
