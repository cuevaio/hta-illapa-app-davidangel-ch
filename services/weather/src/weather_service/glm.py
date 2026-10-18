"""NOAA GOES-19 GLM L2 LCFA (Lightning Cluster-Filter Algorithm): bucket keys, listing, flash parsing.

One NetCDF4/HDF5 file per 20 s (~0.4 MB, full disk) holds events, groups and
flashes. Only flashes are used: one flash is one lightning discharge as seen
from orbit (its constituent optical events clustered in space and time).
Packed variables are unsigned int16 stored as int16 with `scale_factor` /
`add_offset`; flash times are offsets in seconds from the epoch named in their
`units` attribute ("seconds since 2026-10-18 00:00:00.000").
"""

from __future__ import annotations

import datetime as dt
import io
import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from urllib.parse import urlencode

import h5py
import numpy as np

GLM_BUCKET_URL = "https://noaa-goes19.s3.amazonaws.com"
GLM_PRODUCT = "GLM-L2-LCFA"
UTC = dt.timezone.utc
#: flash_quality_flag 0 = good_quality_qf; 1, 3, 5 are degraded flashes (dropped).
GOOD_QUALITY = 0
KM_PER_DEG_LAT = 111.32

_KEY_RE = re.compile(r"OR_GLM-L2-LCFA_G\d+_s(\d{14})_e(\d{14})_c(\d{14})\.nc$")
_S3_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"
_UNITS_RE = re.compile(r"seconds since (\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)")


@dataclass(frozen=True)
class GlmFile:
    key: str
    start: dt.datetime
    end: dt.datetime
    size: int = 0

    @property
    def name(self) -> str:
        return self.key.rsplit("/", 1)[-1]


def parse_glm_time(token: str) -> dt.datetime:
    """`YYYYDDDHHMMSSt` (day of year, tenths of a second) -> UTC datetime."""
    t = dt.datetime.strptime(token[:13], "%Y%j%H%M%S").replace(tzinfo=UTC)
    return t + dt.timedelta(milliseconds=100 * int(token[13]))


def parse_key(key: str, size: int = 0) -> GlmFile | None:
    m = _KEY_RE.search(key)
    if not m:
        return None
    return GlmFile(key, parse_glm_time(m.group(1)), parse_glm_time(m.group(2)), size)


def hour_prefix(t: dt.datetime) -> str:
    t = t.astimezone(UTC)
    return f"{GLM_PRODUCT}/{t:%Y}/{t:%j}/{t:%H}/"


def list_url(base: str, prefix: str, token: str | None = None) -> str:
    q = {"list-type": "2", "prefix": prefix}
    if token:
        q["continuation-token"] = token
    return f"{base}/?{urlencode(q)}"


def object_url(base: str, key: str) -> str:
    return f"{base}/{key}"


def parse_listing(xml: str) -> tuple[list[GlmFile], str | None]:
    """S3 ListObjectsV2 page -> GLM files and the continuation token (None on the last page)."""
    root = ET.fromstring(xml)
    files = []
    for c in root.iter(f"{_S3_NS}Contents"):
        key = c.findtext(f"{_S3_NS}Key") or ""
        f = parse_key(key, int(c.findtext(f"{_S3_NS}Size") or 0))
        if f is not None:
            files.append(f)
    truncated = (root.findtext(f"{_S3_NS}IsTruncated") or "false") == "true"
    return files, (root.findtext(f"{_S3_NS}NextContinuationToken") if truncated else None)


@dataclass(frozen=True)
class Flashes:
    """Columnar flashes: degrees, epoch seconds (UTC), joules, square meters, quality flag."""

    lat: np.ndarray
    lon: np.ndarray
    time: np.ndarray
    energy: np.ndarray
    area: np.ndarray
    quality: np.ndarray

    FIELDS = ("lat", "lon", "time", "energy", "area", "quality")

    def __len__(self) -> int:
        return int(self.lat.shape[0])

    def select(self, mask: np.ndarray) -> "Flashes":
        return Flashes(*(getattr(self, k)[mask] for k in self.FIELDS))

    @staticmethod
    def empty() -> "Flashes":
        z = np.zeros(0)
        return Flashes(z, z, z, z, z, np.zeros(0, dtype=np.int16))

    @staticmethod
    def concat(parts: list["Flashes"]) -> "Flashes":
        if not parts:
            return Flashes.empty()
        return Flashes(*(np.concatenate([getattr(p, k) for p in parts]) for k in Flashes.FIELDS))

    def as_arrays(self) -> dict[str, np.ndarray]:
        return {k: getattr(self, k) for k in self.FIELDS}


def _attr(ds, name: str, default=None):
    v = ds.attrs.get(name)
    if v is None:
        return default
    if isinstance(v, (bytes, np.bytes_)):
        return v.decode()
    return np.asarray(v).ravel()[0]


def _unpacked(ds) -> np.ndarray:
    """CF unpacking: _Unsigned reinterpretation, _FillValue -> NaN, scale_factor / add_offset."""
    raw = ds[()]
    raw = np.atleast_1d(raw)
    fill = _attr(ds, "_FillValue")
    if _attr(ds, "_Unsigned") == "true" and raw.dtype.kind == "i":
        raw = raw.view(raw.dtype.str.replace("i", "u"))
        if fill is not None:
            fill = np.array(fill, dtype=ds.dtype).view(raw.dtype)
    values = raw.astype(np.float64)
    if fill is not None:
        values[raw == fill] = np.nan
    return values * float(_attr(ds, "scale_factor", 1.0)) + float(_attr(ds, "add_offset", 0.0))


def _epoch(units: str) -> float:
    m = _UNITS_RE.search(units)
    if not m:
        raise ValueError(f"unsupported time units: {units!r}")
    return dt.datetime.fromisoformat(f"{m.group(1)}T{m.group(2)}").replace(tzinfo=UTC).timestamp()


def parse_glm(data: bytes) -> Flashes:
    """Every flash of one GLM-L2-LCFA file (no filtering)."""
    with h5py.File(io.BytesIO(data), "r") as f:
        if "flash_lat" not in f or f["flash_lat"].shape[0] == 0:
            return Flashes.empty()
        t = f["flash_time_offset_of_first_event"]
        quality = _unpacked(f["flash_quality_flag"])
        return Flashes(
            lat=f["flash_lat"][()].astype(np.float64),
            lon=f["flash_lon"][()].astype(np.float64),
            time=_unpacked(t) + _epoch(_attr(t, "units", "")),
            energy=_unpacked(f["flash_energy"]),
            area=_unpacked(f["flash_area"]),
            quality=np.where(np.isnan(quality), -1, quality).astype(np.int16),
        )


def filter_flashes(flashes: Flashes, bounds: dict[str, float]) -> Flashes:
    """Good-quality flashes inside a lon/lat box (west, south, east, north)."""
    f = flashes
    ok = (
        (f.quality == GOOD_QUALITY)
        & np.isfinite(f.lat)
        & np.isfinite(f.lon)
        & np.isfinite(f.time)
        & (f.lon >= bounds["west"])
        & (f.lon <= bounds["east"])
        & (f.lat >= bounds["south"])
        & (f.lat <= bounds["north"])
    )
    return f.select(ok)


def cluster_flashes(lat: np.ndarray, lon: np.ndarray, time: np.ndarray, cell_km: float) -> list[dict]:
    """Grid binning: square cells of ~cell_km (longitude scaled at the mean latitude).

    Each cell reports its flash count, centroid and most recent flash time.
    """
    if lat.size == 0:
        return []
    if cell_km <= 0:
        raise ValueError("cell_km must be positive")
    dlat = cell_km / KM_PER_DEG_LAT
    dlon = dlat / max(math.cos(math.radians(float(np.mean(lat)))), 0.1)
    keys = np.stack([np.floor(lat / dlat), np.floor(lon / dlon)], axis=1)
    _, inverse, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    inverse = inverse.ravel()
    n = counts.size
    sum_lat = np.bincount(inverse, lat, n)
    sum_lon = np.bincount(inverse, lon, n)
    latest = np.full(n, -np.inf)
    np.maximum.at(latest, inverse, time)
    order = np.argsort(-counts, kind="stable")
    return [
        {
            "lat": float(sum_lat[i] / counts[i]),
            "lon": float(sum_lon[i] / counts[i]),
            "count": int(counts[i]),
            "latest": float(latest[i]),
        }
        for i in order
    ]
