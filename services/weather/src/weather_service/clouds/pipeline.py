"""GOES-19 (GOES-East) ABI cloud image over Peru: bucket keys, NetCDF reading, styling, PNG.

Ported from peru-simulator scripts/clouds/goes_clouds.py (same projection and look):
  1. Newest ABI-L2-ACMF (clear sky / cloud mask) scan and, by default, the ABI-L2-CMIPF
     band 13 (10.3 um clean IR) file of the same scan.
  2. Cloud_Probabilities (fallback: 4-level ACM) and IR brightness temperature.
  3. Clear sky -> transparent; colder (higher, thicker) tops brighter and more opaque,
     warm low cloud greyer and more translucent; relief-shaded and Gaussian-softened.
  4. Reprojection from the ABI fixed grid to Web Mercator over the configured extent.
  5. Grey + alpha PNG plus its metadata.
"""

from __future__ import annotations

import datetime as dt
import io
import re
import xml.etree.ElementTree as ET
from urllib.parse import urlencode

import h5py
import numpy as np
from PIL import Image

from . import cloud_style as cs
from . import goes_projection as gp

MASK_PRODUCT = "ABI-L2-ACMF"
IR_PRODUCT = "ABI-L2-CMIPF"
_S3_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"
SCAN_START_RE = re.compile(r"_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})(\d)_")


def parse_scan_start(key: str) -> str:
    m = SCAN_START_RE.search(key)
    if not m:
        raise ValueError(f"no scan start in {key}")
    year, doy, hh, mm, ss, tenth = (int(g) for g in m.groups())
    t = dt.datetime(year, 1, 1, hh, mm, ss, tzinfo=dt.timezone.utc) + dt.timedelta(days=doy - 1)
    return t.strftime("%Y-%m-%dT%H:%M:%S") + f".{tenth}Z"


def scan_token(key: str) -> str:
    """`YYYYDDDHHMMSSt` scan start of an ABI file name."""
    m = SCAN_START_RE.search(key)
    if not m:
        raise ValueError(f"no scan start in {key}")
    return "".join(m.groups())


def hour_prefix(product: str, t: dt.datetime) -> str:
    return f"{product}/{t:%Y}/{t.timetuple().tm_yday:03d}/{t:%H}/"


def list_url(base: str, prefix: str, token: str | None = None) -> str:
    q = {"list-type": "2", "prefix": prefix}
    if token:
        q["continuation-token"] = token
    return f"{base.rstrip('/')}/?{urlencode(q)}"


def object_url(base: str, key: str) -> str:
    return f"{base.rstrip('/')}/{key}"


def parse_listing(xml: str) -> tuple[list[tuple[str, int]], str | None]:
    """(key, size) pairs of one ListObjectsV2 page and the continuation token, if any."""
    root = ET.fromstring(xml)
    keys = [
        (c.findtext(f"{_S3_NS}Key") or "", int(c.findtext(f"{_S3_NS}Size") or 0))
        for c in root.iter(f"{_S3_NS}Contents")
    ]
    truncated = (root.findtext(f"{_S3_NS}IsTruncated") or "false") == "true"
    return keys, (root.findtext(f"{_S3_NS}NextContinuationToken") if truncated else None)


def is_ir_partner(key: str, mask_key: str, band: int) -> bool:
    return f"C{band:02d}_" in key and f"_s{scan_token(mask_key)}_" in key and key.endswith(".nc")


# --------------------------------------------------------------------- NetCDF


def read_projection(f: h5py.File) -> gp.GoesProjection:
    a = f["goes_imager_projection"].attrs
    return gp.GoesProjection(
        float(a["perspective_point_height"][0]),
        float(a["semi_major_axis"][0]),
        float(a["semi_minor_axis"][0]),
        float(a["longitude_of_projection_origin"][0]),
    )


def read_axis(f: h5py.File, name: str) -> gp.FixedGridAxis:
    var = f[name]
    raw = var[:2].astype(np.float64)
    scale = float(var.attrs["scale_factor"][0])
    offset = float(var.attrs["add_offset"][0])
    return gp.FixedGridAxis(raw[0] * scale + offset, (raw[1] - raw[0]) * scale)


class SourceWindow:
    """Fractional source pixel coordinates of every output pixel plus the slab to read."""

    def __init__(self, f: h5py.File, grid) -> None:
        self.proj = read_projection(f)
        lon, lat = grid.pixel_centers_lonlat()
        x, y, visible = gp.lonlat_to_scan(self.proj, lon, lat)
        cols = read_axis(f, "x").index_of(x)
        rows = read_axis(f, "y").index_of(y)
        n_rows, n_cols = f["y"].shape[0], f["x"].shape[0]
        self.r0 = max(0, int(np.floor(np.nanmin(rows))) - 2)
        self.r1 = min(n_rows, int(np.ceil(np.nanmax(rows))) + 3)
        self.c0 = max(0, int(np.floor(np.nanmin(cols))) - 2)
        self.c1 = min(n_cols, int(np.ceil(np.nanmax(cols))) + 3)
        self.cols = np.where(visible, cols - self.c0, -1.0)
        self.rows = np.where(visible, rows - self.r0, -1.0)

    def read(self, f: h5py.File, name: str) -> np.ndarray:
        return f[name][self.r0 : self.r1, self.c0 : self.c1]

    def sample(self, slab: np.ndarray) -> np.ndarray:
        return cs.bilinear(slab, self.cols, self.rows)


def mask_opacity(f: h5py.File, win: SourceWindow) -> tuple[np.ndarray, str]:
    """Cloud opacity from the ACMF file on the output grid, and the variable used."""
    dqf = win.read(f, "DQF")
    # DQF: 0 good, 1 bad, 2 space, 6 degraded (kept), 255 fill.
    valid = (dqf != 1) & (dqf != 2) & (dqf != 255)
    if "Cloud_Probabilities" in f:
        var = f["Cloud_Probabilities"]
        raw = win.read(f, "Cloud_Probabilities")
        fill = int(var.attrs["_FillValue"][0])
        valid &= raw != fill
        p = raw.astype(np.float64) * float(var.attrs["scale_factor"][0]) + float(var.attrs["add_offset"][0])
        p = np.where(valid, np.clip(p, 0.0, 1.0), 0.0)
        # Ramp after interpolation so edges blend continuously.
        opacity = cs.probability_opacity(win.sample(p))
        used = "Cloud_Probabilities"
    else:
        levels = win.read(f, "ACM")
        valid &= levels != 255
        opacity = np.nan_to_num(win.sample(np.where(valid, cs.acm_opacity(levels), 0.0)), nan=0.0)
        used = "ACM"
    coverage = np.nan_to_num(win.sample(valid.astype(np.float64)), nan=0.0)
    return opacity * cs.smoothstep(0.5, 1.0, coverage), used


def brightness_temperature(f: h5py.File, win: SourceWindow) -> np.ndarray:
    var = f["CMI"]
    raw = win.read(f, "CMI").view(np.uint16)  # stored as int16 with _Unsigned = true
    bt = raw.astype(np.float64) * float(var.attrs["scale_factor"][0]) + float(var.attrs["add_offset"][0])
    bt[raw > 4095] = cs.BT_WARM + 10.0  # fill / no value -> warm, i.e. no cloud signal
    return win.sample(bt)


def render(mask: np.ndarray, bt: np.ndarray | None, blur_sigma: float) -> tuple[np.ndarray, np.ndarray]:
    mask = cs.gaussian_blur(mask, blur_sigma)
    if bt is None:
        return cs.compose(mask)
    coldness = cs.gaussian_blur(cs.ir_coldness(bt), blur_sigma * 0.75)
    lum, alpha = cs.compose(mask, coldness)
    # Internal texture: shade the cold-top field like a relief, lit from the north-west.
    lum = lum * cs.relief_shading(cs.gaussian_blur(coldness, 1.0))
    return np.clip(lum, 0.0, 1.0), alpha


def encode_png(lum: np.ndarray, alpha: np.ndarray) -> bytes:
    la = np.dstack([(lum * 255 + 0.5).astype(np.uint8), (alpha * 255 + 0.5).astype(np.uint8)])
    buf = io.BytesIO()
    Image.fromarray(la, mode="LA").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def build_image(mask_file, ir_file, grid, blur: float) -> tuple[bytes, dict]:
    """PNG bytes and the image statistics/geometry from the downloaded NetCDF files (paths or file objects)."""
    with h5py.File(mask_file, "r") as f:
        win = SourceWindow(f, grid)
        mask, used = mask_opacity(f, win)
        lon0 = win.proj.longitude_of_projection_origin
    bt = None
    if ir_file is not None:
        with h5py.File(ir_file, "r") as f:
            bt = brightness_temperature(f, SourceWindow(f, grid))
    lum, alpha = render(mask, bt, blur)
    stats = {
        "maskVariable": used,
        "alphaCoverage": round(float((alpha > 0.1).mean()), 4),
        "meanAlpha": round(float(alpha.mean()), 4),
        "projectionLongitude": lon0,
    }
    return encode_png(lum, alpha), stats
