"""Internal height tile format: 512x512 RGB PNG, Terrarium encoding.

    h = R*256 + G + B/256 - 32768   (metres)

Nodata is RGB (0, 0, 0), which decodes to -32768; any pixel decoding to <= -32767 m is nodata.
Valid heights are clamped to [-32766, 32767.99] so they can never collide with nodata.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

NODATA_RGB = (0, 0, 0)
NODATA_THRESHOLD = -32767.0
_MIN_VALID = -32766.0
_MAX_VALID = 32767.0 + 255 / 256


def encode_heights(heights: np.ndarray) -> np.ndarray:
    """Float heights (NaN = nodata) -> uint8 RGB array (H, W, 3)."""
    h = np.asarray(heights, dtype=np.float64)
    nodata = ~np.isfinite(h)
    clamped = np.clip(np.where(nodata, 0.0, h), _MIN_VALID, _MAX_VALID)
    total = np.rint((clamped + 32768.0) * 256.0).astype(np.int64)  # 24-bit fixed point, step 1/256 m
    rgb = np.empty(h.shape + (3,), dtype=np.uint8)
    rgb[..., 0] = (total >> 16) & 0xFF
    rgb[..., 1] = (total >> 8) & 0xFF
    rgb[..., 2] = total & 0xFF
    rgb[nodata] = NODATA_RGB
    return rgb


def decode_rgb(rgb: np.ndarray) -> np.ndarray:
    """uint8 RGB (H, W, 3) -> float64 heights with NaN for nodata."""
    a = np.asarray(rgb, dtype=np.float64)
    h = a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0 - 32768.0
    h[h <= NODATA_THRESHOLD] = np.nan
    return h


def height_stats(rgb: np.ndarray) -> tuple[float | None, float | None]:
    h = decode_rgb(rgb)
    if np.all(np.isnan(h)):
        return None, None
    return float(np.nanmin(h)), float(np.nanmax(h))


def encode_png(rgb: np.ndarray) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(np.ascontiguousarray(rgb, dtype=np.uint8), "RGB").save(buf, format="PNG", optimize=False, compress_level=6)
    return buf.getvalue()


def png_to_rgb(data: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(data)) as im:
        return np.asarray(im.convert("RGB"), dtype=np.uint8)


def decode_png(data: bytes) -> np.ndarray:
    return decode_rgb(png_to_rgb(data))
