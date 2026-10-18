"""Observed lightning: rolling window of GOES-19 GLM flashes over Peru, fetched incrementally.

Every poll lists the bucket's hour prefixes that overlap the window, downloads
only files not seen yet (each ~0.4 MB, one per 20 s: ~180 files / ~75 MB per
hour of backfill), keeps the good-quality flashes inside the Peru box and
drops the raw file. The cropped flashes of each file are cached as a small
`.npz` under `<cache>/glm/`, so restarts need no re-download; files that left
the window are pruned from memory and disk.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import glm
from .glm import Flashes, GlmFile
from .http import Fetcher

log = logging.getLogger("weather.lightning")
UTC = dt.timezone.utc

LIGHTNING_ID = "glm-lightning"
LIGHTNING_SOURCE = "NOAA GOES-19 GLM L2 LCFA flashes (Geostationary Lightning Mapper), via NOAA Open Data Dissemination on AWS"
LIGHTNING_ATTRIBUTION = "NOAA GOES-19 Geostationary Lightning Mapper (GLM)"


def iso(t: dt.datetime | None) -> str | None:
    return None if t is None else t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True)
class LightningPolicy:
    window_minutes: int = 60
    #: Cold start: how far back to fetch (<= window). Later polls fill the window incrementally.
    backfill_minutes: int = 60
    poll_seconds: int = 60
    retry_max_seconds: int = 600
    #: A past hour's listing is final this long after the hour ends (publication latency).
    listing_settle: dt.timedelta = dt.timedelta(minutes=5)


@dataclass
class _Entry:
    file: GlmFile
    flashes: Flashes


class LightningService:
    def __init__(
        self,
        fetcher: Fetcher,
        cache_dir: Path,
        bounds: dict[str, float],
        policy: LightningPolicy = LightningPolicy(),
        base_url: str = glm.GLM_BUCKET_URL,
        clock=lambda: dt.datetime.now(UTC),
        concurrency: int = 4,
    ) -> None:
        self.fetcher = fetcher
        self.cache_dir = cache_dir
        self.bounds = bounds
        self.policy = policy
        self.base_url = base_url
        self.clock = clock
        self._sem = asyncio.Semaphore(concurrency)
        self._entries: dict[str, _Entry] = {}
        #: Final listings of past hours (prefix -> files).
        self._listings: dict[str, list[GlmFile]] = {}
        #: Unreadable files are remembered so they are not downloaded again.
        self._bad: set[str] = set()
        self._task: asyncio.Task | None = None
        self.status = "idle"
        self.error: str | None = None
        self.failures = 0
        self.last_attempt: dt.datetime | None = None
        self.last_success: dt.datetime | None = None
        self.next_refresh: dt.datetime | None = None
        self.last_download_bytes = 0
        self.last_files = 0
        self.total_download_bytes = 0
        self.last_duration_s: float | None = None

    # state -------------------------------------------------------------------
    @property
    def skipped_files(self) -> int:
        return len(self._bad)

    def files(self) -> list[GlmFile]:
        return sorted((e.file for e in self._entries.values()), key=lambda f: f.start)

    @property
    def obs_time(self) -> dt.datetime | None:
        """End of the newest ingested file: flashes are complete up to here."""
        return max((e.file.end for e in self._entries.values()), default=None)

    def coverage_start(self) -> dt.datetime | None:
        if not self._entries:
            return None
        start = self.clock() - dt.timedelta(minutes=self.policy.window_minutes)
        return max(start, min(e.file.start for e in self._entries.values()))

    def window(self, minutes: float) -> Flashes:
        """Flashes of the last `minutes` before now, oldest first."""
        since = (self.clock() - dt.timedelta(minutes=minutes)).timestamp()
        f = Flashes.concat([e.flashes for e in self._entries.values()])
        f = f.select(f.time >= since)
        return f.select(np.argsort(f.time, kind="stable"))

    # cache -------------------------------------------------------------------
    def _cache_path(self, f: GlmFile) -> Path:
        return self.cache_dir / (f.name.removesuffix(".nc") + ".npz")

    def load_cached(self) -> None:
        if not self.cache_dir.is_dir():
            return
        cutoff = self.clock() - dt.timedelta(minutes=self.policy.window_minutes)
        for p in sorted(self.cache_dir.glob("*.npz")):
            f = glm.parse_key(p.stem + ".nc")
            if f is None or f.key in self._entries:
                continue
            if f.end <= cutoff:
                p.unlink(missing_ok=True)
                continue
            try:
                with np.load(p) as z:
                    flashes = Flashes(*(z[k] for k in Flashes.FIELDS))
            except (OSError, ValueError, KeyError) as err:
                log.warning("glm cache %s unusable: %s", p.name, err)
                continue
            self._entries[f.name] = _Entry(f, flashes)
        if self._entries:
            self.status = "ready"
            log.info("%s: restored %d files from cache", LIGHTNING_ID, len(self._entries))

    def _write_cache(self, f: GlmFile, flashes: Flashes) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = self._cache_path(f).with_suffix(".tmp.npz")
        np.savez(tmp, **flashes.as_arrays())
        tmp.replace(self._cache_path(f))

    def prune(self) -> None:
        cutoff = self.clock() - dt.timedelta(minutes=self.policy.window_minutes)
        for name, e in list(self._entries.items()):
            if e.file.end <= cutoff:
                del self._entries[name]
                self._cache_path(e.file).unlink(missing_ok=True)
        oldest = glm.hour_prefix(cutoff)
        for prefix in [p for p in self._listings if p < oldest]:
            del self._listings[prefix]

    # refresh -----------------------------------------------------------------
    async def _list_hour(self, hour: dt.datetime, now: dt.datetime, downloaded: list[int]) -> list[GlmFile]:
        prefix = glm.hour_prefix(hour)
        if prefix in self._listings:
            return self._listings[prefix]
        files: list[GlmFile] = []
        token = None
        while True:
            async with self._sem:
                text = await self.fetcher.get_text(glm.list_url(self.base_url, prefix, token))
            downloaded.append(len(text.encode()))
            page, token = glm.parse_listing(text)
            files += page
            if token is None:
                break
        if now >= hour + dt.timedelta(hours=1) + self.policy.listing_settle:
            self._listings[prefix] = files
        return files

    async def _ingest(self, f: GlmFile, downloaded: list[int]) -> None:
        async with self._sem:
            data = await self.fetcher.get_bytes(glm.object_url(self.base_url, f.key))
        downloaded.append(len(data))
        try:
            flashes = await asyncio.to_thread(glm.parse_glm, data)
        except (OSError, ValueError, KeyError) as err:
            log.warning("glm %s unreadable (%s); skipped", f.name, err)
            self._bad.add(f.name)
            return
        flashes = glm.filter_flashes(flashes, self.bounds)
        await asyncio.to_thread(self._write_cache, f, flashes)
        self._entries[f.name] = _Entry(f, flashes)

    async def refresh(self) -> None:
        now = self.clock()
        self.last_attempt = now
        started = time.perf_counter()
        try:
            minutes = self.policy.window_minutes if self._entries else min(self.policy.backfill_minutes, self.policy.window_minutes)
            since = now - dt.timedelta(minutes=minutes)
            hour = since.replace(minute=0, second=0, microsecond=0)
            hours = []
            while hour <= now:
                hours.append(hour)
                hour += dt.timedelta(hours=1)
            downloaded: list[int] = []
            listings = await asyncio.gather(*(self._list_hour(h, now, downloaded) for h in hours))
            wanted = sorted(
                (
                    f
                    for files in listings
                    for f in files
                    if since < f.end <= now and f.name not in self._entries and f.name not in self._bad
                ),
                key=lambda f: f.start,
            )
            await asyncio.gather(*(self._ingest(f, downloaded) for f in wanted))
            self.prune()
            self.status = "ready"
            self.error = None
            self.failures = 0
            self.last_success = now
            self.last_files = len(wanted)
            self.last_download_bytes = sum(downloaded)
            self.total_download_bytes += self.last_download_bytes
            self.last_duration_s = time.perf_counter() - started
            if wanted:
                log.info(
                    "%s: +%d files (%.1f MB, %.1fs), %d flashes in the %d-min window",
                    LIGHTNING_ID, len(wanted), self.last_download_bytes / 1e6, self.last_duration_s,
                    len(self.window(self.policy.window_minutes)), self.policy.window_minutes,
                )
        except asyncio.CancelledError:
            raise
        except Exception as err:  # keep the flashes we have, report the error
            self.failures += 1
            self.error = f"{type(err).__name__}: {err}"
            self.status = "stale" if self._entries else "error"
            log.warning("%s: refresh failed (%s)", LIGHTNING_ID, self.error)

    def next_delay(self) -> float:
        if self.failures:
            return float(min(self.policy.poll_seconds * 2 ** (self.failures - 1), self.policy.retry_max_seconds))
        return float(self.policy.poll_seconds)

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name=f"refresh-{LIGHTNING_ID}")

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

    # catalog -----------------------------------------------------------------
    def catalog_entry(self) -> dict:
        now = self.clock()
        obs = self.obs_time
        return {
            "id": LIGHTNING_ID,
            "title": "Lightning (observed)",
            "kind": "observed",
            "valueKind": "events",
            "source": LIGHTNING_SOURCE,
            "attribution": LIGHTNING_ATTRIBUTION,
            "description": (
                "GLM flashes (good quality only) inside the Peru box; time = first optical event of the flash. "
                "A rolling window ending now, not forecast times."
            ),
            "units": "flashes",
            "status": self.status,
            "error": self.error,
            "issueTime": None,
            "obsTime": iso(obs),
            "ageSeconds": None if obs is None else round((now - obs).total_seconds()),
            "windowMinutes": self.policy.window_minutes,
            "coverageStart": iso(self.coverage_start()),
            "flashCount": len(self.window(self.policy.window_minutes)),
            "filesInWindow": len(self._entries),
            "skippedFiles": self.skipped_files,
            "lastSuccess": iso(self.last_success),
            "lastAttempt": iso(self.last_attempt),
            "nextRefresh": iso(self.next_refresh),
            "lastDownloadBytes": self.last_download_bytes,
            "totalDownloadBytes": self.total_download_bytes,
            "bounds": self.bounds,
            "times": [],
        }
