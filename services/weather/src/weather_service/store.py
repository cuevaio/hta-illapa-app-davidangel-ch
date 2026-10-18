"""Disk cache: raw GRIB messages and processed grids, keyed by cycle / forecast hour / field."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class Store:
    """Layout under `root`:

    raw/gfs/<cycle>/<field>_f<FFF>.grib2          one GRIB2 message (range download)
    products/<product>/<cycle>/<time>.bin|.json    encoded grid + its metadata
    products/<product>/<cycle>/manifest.json       written last: marks the cycle complete
    """

    def __init__(self, root: Path) -> None:
        self.root = root

    # raw -----------------------------------------------------------------
    def raw_path(self, cycle: str, field_key: str, fhour: int) -> Path:
        return self.root / "raw" / "gfs" / cycle / f"{field_key}_f{fhour:03d}.grib2"

    def read_raw(self, cycle: str, field_key: str, fhour: int) -> bytes | None:
        p = self.raw_path(cycle, field_key, fhour)
        return p.read_bytes() if p.is_file() else None

    def write_raw(self, cycle: str, field_key: str, fhour: int, data: bytes) -> None:
        _atomic_write(self.raw_path(cycle, field_key, fhour), data)

    # products --------------------------------------------------------------
    def cycle_dir(self, product: str, cycle: str) -> Path:
        return self.root / "products" / product / cycle

    def write_frame(self, product: str, cycle: str, time_id: str, grid: bytes, meta: dict) -> None:
        d = self.cycle_dir(product, cycle)
        _atomic_write(d / f"{time_id}.bin", grid)
        _atomic_write(d / f"{time_id}.json", json.dumps(meta, indent=1).encode())

    def read_frame(self, product: str, cycle: str, time_id: str) -> bytes | None:
        p = self.cycle_dir(product, cycle) / f"{time_id}.bin"
        return p.read_bytes() if p.is_file() else None

    def write_manifest(self, product: str, cycle: str, manifest: dict) -> None:
        _atomic_write(self.cycle_dir(product, cycle) / "manifest.json", json.dumps(manifest, indent=1).encode())

    def latest_manifest(self, product: str) -> dict | None:
        """Newest complete cycle on disk (the last good data survives restarts)."""
        base = self.root / "products" / product
        if not base.is_dir():
            return None
        for d in sorted((p for p in base.iterdir() if p.is_dir()), reverse=True):
            m = d / "manifest.json"
            if not m.is_file():
                continue
            try:
                manifest = json.loads(m.read_text())
            except (OSError, ValueError):
                continue
            if all((d / f"{f['id']}.bin").is_file() for f in manifest.get("frames", [])):
                return manifest
        return None

    def prune(self, product: str, keep_cycles: int = 2) -> None:
        base = self.root / "products" / product
        if base.is_dir():
            dirs = sorted((p for p in base.iterdir() if p.is_dir()), reverse=True)
            complete = [d for d in dirs if (d / "manifest.json").is_file()]
            keep = set(complete[:keep_cycles])
            newest = complete[0] if complete else None
            for d in dirs:
                # An incomplete cycle newer than the newest complete one may be in progress.
                in_progress = d not in complete and (newest is None or d.name > newest.name)
                if d not in keep and not in_progress:
                    shutil.rmtree(d, ignore_errors=True)
        raw = self.root / "raw" / "gfs"
        if raw.is_dir():
            for d in sorted((p for p in raw.iterdir() if p.is_dir()), reverse=True)[keep_cycles + 1 :]:
                shutil.rmtree(d, ignore_errors=True)
