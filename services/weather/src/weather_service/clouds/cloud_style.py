"""Pure raster styling: cloud mask + IR brightness temperature -> "TV weather" clouds.

All functions operate on float numpy arrays and are deterministic, so they
are unit-tested without any network or NetCDF input.
"""

from __future__ import annotations

import numpy as np

# Cloud_Probabilities ramp: below LOW is clear, above HIGH is fully cloudy.
PROBABILITY_LOW = 0.30
PROBABILITY_HIGH = 0.85
# Graded opacity for the 4-level ACM mask (clear, probably clear, probably cloudy, cloudy).
ACM_OPACITY = np.array([0.0, 0.15, 0.6, 1.0])
# Brightness temperature range: warm surfaces / low cloud .. cold deep-convective tops (K).
BT_WARM = 290.0
BT_COLD = 205.0
# Minimum opacity of a fully cloudy but warm (low, thin) pixel when IR is available.
LOW_CLOUD_OPACITY = 0.32
# Strength of the relief shading derived from the cloud-top temperature field.
RELIEF_STRENGTH = 9.0


def smoothstep(edge0: float, edge1: float, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def probability_opacity(p):
    """Continuous cloud probability (0..1, NaN = unknown) -> mask opacity."""
    p = np.nan_to_num(np.asarray(p, dtype=np.float64), nan=0.0)
    return smoothstep(PROBABILITY_LOW, PROBABILITY_HIGH, p)


def acm_opacity(levels):
    """4-level ACM values (0..3, anything else = invalid) -> graded opacity."""
    levels = np.asarray(levels)
    out = np.zeros(levels.shape, dtype=np.float64)
    ok = (levels >= 0) & (levels <= 3)
    out[ok] = ACM_OPACITY[levels[ok].astype(np.int64)]
    return out


def ir_coldness(bt):
    """Brightness temperature (K, NaN = unknown) -> 0 (warm) .. 1 (very cold tops)."""
    bt = np.nan_to_num(np.asarray(bt, dtype=np.float64), nan=BT_WARM)
    return np.clip((BT_WARM - bt) / (BT_WARM - BT_COLD), 0.0, 1.0)


def compose(mask_opacity, coldness=None):
    """Returns (luminance, alpha) in 0..1.

    The mask decides where clouds are; IR coldness makes high, thick tops bright
    white and opaque, and warm, low cloud greyer and more translucent.
    """
    mask = np.clip(np.asarray(mask_opacity, dtype=np.float64), 0.0, 1.0)
    if coldness is None:
        return 0.80 + 0.20 * mask, 0.85 * mask
    c = np.clip(np.asarray(coldness, dtype=np.float64), 0.0, 1.0)
    alpha = mask * (LOW_CLOUD_OPACITY + (1.0 - LOW_CLOUD_OPACITY) * smoothstep(0.05, 0.55, c))
    luminance = 0.66 + 0.34 * c**0.8
    return luminance, alpha


def gaussian_kernel(sigma: float) -> np.ndarray:
    radius = max(1, int(np.ceil(3.0 * sigma)))
    t = np.arange(-radius, radius + 1, dtype=np.float64)
    k = np.exp(-0.5 * (t / sigma) ** 2)
    return k / k.sum()


def gaussian_blur(field, sigma: float):
    """Separable Gaussian blur with edge clamping (sigma in pixels, 0 = no-op)."""
    a = np.asarray(field, dtype=np.float64)
    if sigma <= 0:
        return a.copy()
    k = gaussian_kernel(sigma)
    r = len(k) // 2
    for axis in (0, 1):
        pad = [(0, 0), (0, 0)]
        pad[axis] = (r, r)
        p = np.pad(a, pad, mode="edge")
        n = a.shape[axis]
        out = np.zeros_like(a)
        for i, w in enumerate(k):
            out += w * (p[i : i + n, :] if axis == 0 else p[:, i : i + n])
        a = out
    return a


def relief_shading(height, light=(-0.6, -0.8), strength: float = RELIEF_STRENGTH):
    """Lambert-like shading factor (~0.75..1.15) of a 0..1 'cloud top height' field.

    `light` is the 2D direction (dx, dy in pixel axes; y grows downward) the light
    comes from, so slopes facing it brighten and the opposite ones darken.
    """
    h = np.asarray(height, dtype=np.float64)
    gy, gx = np.gradient(h)
    lx, ly = light
    norm = np.hypot(lx, ly)
    slope = -(gx * lx + gy * ly) / norm
    return np.clip(1.0 + strength * slope, 0.75, 1.15)


def bilinear(slab, cols, rows):
    """Samples `slab` at fractional pixel coordinates; outside samples return NaN."""
    slab = np.asarray(slab, dtype=np.float64)
    h, w = slab.shape
    cols = np.asarray(cols, dtype=np.float64)
    rows = np.asarray(rows, dtype=np.float64)
    inside = (cols >= 0) & (cols <= w - 1) & (rows >= 0) & (rows <= h - 1)
    c = np.clip(cols, 0, w - 1)
    r = np.clip(rows, 0, h - 1)
    c0 = np.minimum(np.floor(c).astype(np.int64), w - 2) if w > 1 else np.zeros(c.shape, np.int64)
    r0 = np.minimum(np.floor(r).astype(np.int64), h - 2) if h > 1 else np.zeros(r.shape, np.int64)
    fc = c - c0
    fr = r - r0
    c1 = np.minimum(c0 + 1, w - 1)
    r1 = np.minimum(r0 + 1, h - 1)
    top = slab[r0, c0] * (1 - fc) + slab[r0, c1] * fc
    bottom = slab[r1, c0] * (1 - fc) + slab[r1, c1] * fc
    out = top * (1 - fr) + bottom * fr
    out[~inside] = np.nan
    return out
