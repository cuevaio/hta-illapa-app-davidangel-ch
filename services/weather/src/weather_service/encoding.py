"""Compact grid encoding: little-endian Uint16 with linear scale/offset and a nodata code."""

from __future__ import annotations

import numpy as np

NODATA = 65535
MAX_CODE = 65534


def encode_uint16(values: np.ndarray) -> tuple[bytes, dict]:
    """value = code * scale + offset for code < 65535; 65535 means no data."""
    finite = np.isfinite(values)
    if finite.any():
        vmin = float(values[finite].min())
        vmax = float(values[finite].max())
    else:
        vmin = vmax = 0.0
    scale = (vmax - vmin) / MAX_CODE if vmax > vmin else 1.0
    codes = np.full(values.shape, NODATA, dtype="<u2")
    codes[finite] = np.clip(np.rint((values[finite] - vmin) / scale), 0, MAX_CODE).astype("<u2")
    meta = {
        "type": "uint16",
        "byteOrder": "little",
        "scale": scale,
        "offset": vmin,
        "nodata": NODATA,
        "min": vmin if finite.any() else None,
        "max": vmax if finite.any() else None,
    }
    return codes.tobytes(), meta


def decode_uint16(data: bytes, meta: dict, shape: tuple[int, int]) -> np.ndarray:
    codes = np.frombuffer(data, dtype="<u2").reshape(shape)
    out = codes.astype(np.float64) * meta["scale"] + meta["offset"]
    out[codes == NODATA] = np.nan
    return out.astype(np.float32)


def encode_bands(bands: list[tuple[str, np.ndarray]]) -> tuple[bytes, dict]:
    """Band-sequential Uint16 grid; each band has its own scale/offset.

    A cell missing in any band is written as nodata in every band, so a
    decoded vector is either complete or missing.
    """
    missing = np.zeros(bands[0][1].shape, dtype=bool)
    for _, values in bands:
        missing |= ~np.isfinite(values)
    chunks: list[bytes] = []
    metas: list[dict] = []
    for name, values in bands:
        data, m = encode_uint16(np.where(missing, np.nan, values))
        chunks.append(data)
        metas.append({"name": name, "scale": m["scale"], "offset": m["offset"], "min": m["min"], "max": m["max"]})
    meta = {"type": "uint16", "byteOrder": "little", "layout": "band-sequential", "nodata": NODATA, "bands": metas}
    return b"".join(chunks), meta


def decode_bands(data: bytes, meta: dict, shape: tuple[int, int]) -> list[np.ndarray]:
    n = shape[0] * shape[1] * 2
    return [decode_uint16(data[i * n : (i + 1) * n], b | {"nodata": meta["nodata"]}, shape) for i, b in enumerate(meta["bands"])]
