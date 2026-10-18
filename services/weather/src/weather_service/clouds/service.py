"""Cloud product: periodic GOES-19 cloud image over Peru, cached on disk, with a committed fallback.

Every `poll_seconds` (default 10 min, the ABI full-disk cadence) the service lists the
newest ABI-L2-ACMF hour of the public noaa-goes19 bucket, picks the newest scan that also
has its band-13 IR file (mask only when none has), and skips the work when that scan is
already served. The two NetCDF files (~26 + ~24 MB) are kept on disk only for the current
scan; generated images go to `<cache>/images/<scan>.png` + `.json` (metadata written
last) and the newest `keep_images` are kept. Until the first image exists the committed
sample is served (`fallback: true`). Failures back off and keep the last image (`stale`).
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from ..http import Fetcher
from . import pipeline as pl

log = logging.getLogger("weather.clouds")
UTC = dt.timezone.utc

CLOUDS_ID = "goes-clouds"
GOES_BUCKET_URL = "https://noaa-goes19.s3.amazonaws.com"
CLOUDS_SOURCE = (
    "NOAA GOES-19 ABI L2 Clear Sky Mask (ABI-L2-ACMF) + CMIP band 13 (ABI-L2-CMIPF), "
    "via NOAA Open Data Dissemination on AWS"
)
CLOUDS_ATTRIBUTION = "NOAA GOES-19 ABI L2 products via the NOAA Open Data Dissemination program on AWS"


def iso(t: dt.datetime | None) -> str | None:
    return None if t is None else t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(text: str | None) -> dt.datetime | None:
    return None if not text else dt.datetime.fromisoformat(text.replace("Z", "+00:00"))


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


@dataclass(frozen=True)
class CloudPolicy:
    poll_seconds: int = 600
    retry_base_seconds: int = 60
    retry_max_seconds: int = 1800
    keep_images: int = 6
    ir: bool = True
    ir_band: int = 13
    blur: float = 1.4
    #: Hours walked back to find a non-empty ACMF hour.
    hours_back: int = 3
    #: Newest scans tried when looking for one with an IR partner.
    ir_candidates: int = 3


@dataclass
class CloudImage:
    token: str
    meta: dict
    path: Path | None  # None: in-memory bytes (fallback sample)
    data: bytes | None = None

    def read(self) -> bytes:
        return self.data if self.data is not None else self.path.read_bytes()  # type: ignore[union-attr]


class CloudService:
    def __init__(
        self,
        fetcher: Fetcher,
        cache_dir: Path,
        grid,
        policy: CloudPolicy = CloudPolicy(),
        sample_dir: Path | None = None,
        base_url: str = GOES_BUCKET_URL,
        clock=lambda: dt.datetime.now(UTC),
    ) -> None:
        self.fetcher = fetcher
        self.cache_dir = cache_dir
        self.grid = grid
        self.policy = policy
        self.sample_dir = sample_dir
        self.base_url = base_url
        self.clock = clock
        self.current: CloudImage | None = None
        self._sample: CloudImage | None = None
        self._task: asyncio.Task | None = None
        self.status = "idle"  # idle | loading | ready | stale | error
        self.error: str | None = None
        self.failures = 0
        self.last_attempt: dt.datetime | None = None
        self.last_success: dt.datetime | None = None
        self.next_refresh: dt.datetime | None = None
        self.last_download_bytes = 0
        self.last_listing_bytes = 0
        self.total_download_bytes = 0
        self.last_duration_s: float | None = None

    @property
    def images_dir(self) -> Path:
        return self.cache_dir / "images"

    @property
    def raw_dir(self) -> Path:
        return self.cache_dir / "raw"

    # cache -------------------------------------------------------------------
    def _cached_images(self) -> list[CloudImage]:
        """Complete cached images (metadata + PNG), oldest first."""
        out = []
        if self.images_dir.is_dir():
            for j in sorted(self.images_dir.glob("*.json")):
                png = j.with_suffix(".png")
                if not png.is_file():
                    continue
                try:
                    meta = json.loads(j.read_text())
                except (OSError, ValueError):
                    continue
                out.append(CloudImage(j.stem, meta, png))
        return out

    def load_cached(self) -> None:
        images = self._cached_images()
        if images:
            self.current = images[-1]
            self.status = "ready"
            self.last_success = _parse_iso(self.current.meta.get("generatedAt"))
            log.info("%s: restored scan %s from cache", CLOUDS_ID, self.current.meta.get("scanStart"))
        self._load_sample()

    def _load_sample(self) -> None:
        if self.sample_dir is None:
            return
        j, png = self.sample_dir / "sample.json", self.sample_dir / "sample.png"
        try:
            meta = json.loads(j.read_text())
            self._sample = CloudImage("sample", meta, None, png.read_bytes())
        except (OSError, ValueError) as err:
            log.warning("%s: fallback sample unavailable (%s)", CLOUDS_ID, err)

    def _prune(self, keep_raw: set[str]) -> None:
        images = self._cached_images()
        for img in images[: max(0, len(images) - self.policy.keep_images)]:
            img.path.unlink(missing_ok=True)  # type: ignore[union-attr]
            (self.images_dir / f"{img.token}.json").unlink(missing_ok=True)
        if self.raw_dir.is_dir():
            for p in self.raw_dir.glob("*.nc"):
                if p.name not in keep_raw:
                    p.unlink(missing_ok=True)

    # refresh -----------------------------------------------------------------
    async def _list(self, prefix: str, downloaded: list[int]) -> list[tuple[str, int]]:
        keys: list[tuple[str, int]] = []
        token = None
        while True:
            text = await self.fetcher.get_text(pl.list_url(self.base_url, prefix, token))
            downloaded.append(len(text.encode()))
            page, token = pl.parse_listing(text)
            keys += page
            if token is None:
                return keys

    async def _recent_masks(self, now: dt.datetime, downloaded: list[int]) -> list[tuple[str, int]]:
        """ACMF keys of the newest non-empty hour, newest scan first."""
        for h in range(self.policy.hours_back + 1):
            t = now - dt.timedelta(hours=h)
            keys = [k for k in await self._list(pl.hour_prefix(pl.MASK_PRODUCT, t), downloaded) if k[0].endswith(".nc")]
            if keys:
                return sorted(keys, key=lambda k: pl.scan_token(k[0]), reverse=True)
        raise RuntimeError(f"no {pl.MASK_PRODUCT} files in the last {self.policy.hours_back} hours")

    async def _ir_partner(self, mask_key: str, downloaded: list[int]) -> tuple[str, int] | None:
        t = dt.datetime.strptime(pl.scan_token(mask_key)[:9], "%Y%j%H").replace(tzinfo=UTC)
        prefix = pl.hour_prefix(pl.IR_PRODUCT, t) + f"OR_{pl.IR_PRODUCT}-"
        for key, size in await self._list(prefix, downloaded):
            if pl.is_ir_partner(key, mask_key, self.policy.ir_band):
                return key, size
        return None

    async def _download(self, key: str, size: int, downloaded: list[int]) -> Path:
        path = self.raw_dir / Path(key).name
        if path.is_file() and (size <= 0 or path.stat().st_size == size):
            return path
        data = await self.fetcher.get_bytes(pl.object_url(self.base_url, key))
        downloaded.append(len(data))
        await asyncio.to_thread(_atomic_write, path, data)
        return path

    async def refresh(self) -> None:
        now = self.clock()
        self.last_attempt = now
        started = time.perf_counter()
        try:
            listing: list[int] = []
            candidates = await self._recent_masks(now, listing)
            mask_key, mask_size = candidates[0]
            ir = None
            if self.policy.ir:
                # The IR file of a scan is usually published first; if the newest mask has no
                # IR partner yet, step back to the newest scan that has both.
                for key, size in candidates[: self.policy.ir_candidates]:
                    ir = await self._ir_partner(key, listing)
                    if ir:
                        mask_key, mask_size = key, size
                        break
            token = pl.scan_token(mask_key)
            self.last_listing_bytes = sum(listing)
            if self.current is not None and self.current.token == token:
                self.status, self.error, self.failures = "ready", None, 0
                self.last_download_bytes = self.last_listing_bytes
                return
            if self.current is None:
                self.status = "loading"
            downloaded: list[int] = []
            mask_path = await self._download(mask_key, mask_size, downloaded)
            ir_path = await self._download(ir[0], ir[1], downloaded) if ir else None
            png, stats = await asyncio.to_thread(pl.build_image, mask_path, ir_path, self.grid, self.policy.blur)
            g = self.grid
            meta = {
                "version": 1,
                "satellite": "GOES-19",
                "product": pl.MASK_PRODUCT,
                "maskVariable": stats["maskVariable"],
                "irBand": self.policy.ir_band if ir else None,
                "scanStart": pl.parse_scan_start(mask_key),
                "generatedAt": iso(self.clock()),
                "sourceKeys": {"mask": mask_key, "ir": ir[0] if ir else None},
                "image": f"{token}.png",
                "width": g.width,
                "height": g.height,
                "lonLatBounds": g.lonlat_bounds(),
                "mercatorBounds": {"minX": g.min_x, "minY": g.min_y, "maxX": g.max_x, "maxY": g.max_y},
                "alphaCoverage": stats["alphaCoverage"],
                "meanAlpha": stats["meanAlpha"],
                "projectionLongitude": stats["projectionLongitude"],
            }
            png_path = self.images_dir / f"{token}.png"
            await asyncio.to_thread(_atomic_write, png_path, png)
            # Metadata last: a reader that sees it always finds the matching image.
            await asyncio.to_thread(_atomic_write, self.images_dir / f"{token}.json", json.dumps(meta, indent=1).encode())
            self.current = CloudImage(token, meta, png_path)
            self._prune({mask_path.name, ir_path.name if ir_path else ""})
            self.status, self.error, self.failures = "ready", None, 0
            self.last_success = self.clock()
            self.last_download_bytes = sum(downloaded) + self.last_listing_bytes
            self.total_download_bytes += self.last_download_bytes
            self.last_duration_s = time.perf_counter() - started
            log.info(
                "%s: scan %s ready (%dx%d, %.1f MB downloaded, %.1fs, alpha>0.1 %.1f%%)",
                CLOUDS_ID, meta["scanStart"], g.width, g.height, self.last_download_bytes / 1e6,
                self.last_duration_s, stats["alphaCoverage"] * 100,
            )
        except asyncio.CancelledError:
            raise
        except Exception as err:  # keep the last image, report the error
            self.failures += 1
            self.error = f"{type(err).__name__}: {err}"
            self.status = "stale" if self.current else "error"
            log.warning("%s: refresh failed (%s)", CLOUDS_ID, self.error)

    def next_delay(self) -> float:
        if self.failures:
            delay = self.policy.retry_base_seconds * 2 ** (self.failures - 1)
            return float(min(delay, self.policy.retry_max_seconds))
        return float(self.policy.poll_seconds)

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name=f"refresh-{CLOUDS_ID}")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    async def _run(self) -> None:
        while True:
            await self.refresh()
            delay = self.next_delay()
            self.next_refresh = self.clock() + dt.timedelta(seconds=delay)
            await asyncio.sleep(delay)

    # queries -----------------------------------------------------------------
    def served(self) -> CloudImage | None:
        return self.current or self._sample

    def image(self, token: str | None) -> CloudImage | None:
        """The served image, or a kept scan by token."""
        if token is None:
            return self.served()
        if self.current is not None and self.current.token == token:
            return self.current
        return next((i for i in self._cached_images() if i.token == token), None)

    def image_bytes(self, token: str | None = None) -> bytes | None:
        img = self.image(token)
        return None if img is None else img.read()

    def meta(self) -> dict:
        img = self.served()
        base = dict(img.meta) if img else {}
        base.pop("image", None)
        scan = _parse_iso(base.get("scanStart"))
        return base | {
            "id": CLOUDS_ID,
            "fallback": self.current is None,
            "status": self.status,
            "error": self.error,
            "source": CLOUDS_SOURCE,
            "attribution": CLOUDS_ATTRIBUTION,
            "ageSeconds": None if scan is None else round((self.clock() - scan).total_seconds()),
            "imagePath": None if img is None else f"/api/clouds/image?scan={img.token}",
            "history": [
                {"scan": i.token, "scanStart": i.meta.get("scanStart"), "imagePath": f"/api/clouds/image?scan={i.token}"}
                for i in self._cached_images()
            ],
            "lastSuccess": iso(self.last_success),
            "lastAttempt": iso(self.last_attempt),
            "nextRefresh": iso(self.next_refresh),
            "lastDownloadBytes": self.last_download_bytes,
        }

    def catalog_entry(self) -> dict:
        m = self.meta()
        scan = _parse_iso(m.get("scanStart"))
        return {
            "id": CLOUDS_ID,
            "title": "Clouds (observed)",
            "kind": "observed",
            "valueKind": "image",
            "source": CLOUDS_SOURCE,
            "attribution": CLOUDS_ATTRIBUTION,
            "description": (
                "GOES-19 ABI cloud probability (ACM) shaded with band 13 IR brightness temperature, "
                "reprojected to Web Mercator; grey + alpha PNG, one scan every 10 min."
            ),
            "units": None,
            "status": self.status,
            "error": self.error,
            "fallback": m["fallback"],
            "issueTime": None,
            "obsTime": iso(scan),
            "ageSeconds": m["ageSeconds"],
            "imagePath": m["imagePath"],
            "metaPath": "/api/clouds",
            "width": m.get("width"),
            "height": m.get("height"),
            "lonLatBounds": m.get("lonLatBounds"),
            "mercatorBounds": m.get("mercatorBounds"),
            "lastSuccess": m["lastSuccess"],
            "lastAttempt": m["lastAttempt"],
            "nextRefresh": m["nextRefresh"],
            "lastDownloadBytes": self.last_download_bytes,
            "times": [],
        }
