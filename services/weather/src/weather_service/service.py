"""Per-product refresh: cycle selection, download, decode, reprojection, cache and status."""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import time
from dataclasses import dataclass, field

import numpy as np

from . import gfs
from .decode import decode_message
from .encoding import decode_bands, decode_uint16, encode_bands, encode_uint16
from .grid import MercatorGrid, resample_to_mercator
from .http import Fetcher, NotFound
from .products import ProductSpec
from .store import Store
from .wind import wind_speed

log = logging.getLogger("weather.service")
UTC = dt.timezone.utc


@dataclass(frozen=True)
class RefreshPolicy:
    #: Typical delay after the cycle time until the configured forecast hours are all published.
    publish_delay: dt.timedelta = dt.timedelta(hours=4)
    poll_interval: dt.timedelta = dt.timedelta(minutes=10)
    retry_base: dt.timedelta = dt.timedelta(minutes=1)
    retry_max: dt.timedelta = dt.timedelta(minutes=30)
    #: How many cycles back to look for a complete one.
    lookback_cycles: int = 4


def next_refresh_delay(now: dt.datetime, cycle: dt.datetime | None, failures: int, policy: RefreshPolicy) -> float:
    """Seconds until the next refresh attempt, aligned to GFS availability.

    Failures back off exponentially. Otherwise sleep until the next cycle is
    expected to be complete, then poll at `poll_interval` until it appears.
    """
    if failures > 0:
        delay = policy.retry_base * 2 ** (failures - 1)
        return min(delay, policy.retry_max).total_seconds()
    if cycle is None:
        return 0.0
    expected = cycle + dt.timedelta(hours=gfs.CYCLE_HOURS) + policy.publish_delay
    if now < expected:
        return (expected - now).total_seconds()
    return policy.poll_interval.total_seconds()


def time_id(t: dt.datetime) -> str:
    return t.strftime("%Y%m%dT%H%MZ")


def iso(t: dt.datetime | None) -> str | None:
    return None if t is None else t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class Frame:
    id: str
    valid_time: dt.datetime
    forecast_hour: int
    meta: dict


@dataclass
class ProductState:
    spec: ProductSpec
    status: str = "idle"  # idle | loading | ready | stale | error
    cycle: dt.datetime | None = None
    frames: list[Frame] = field(default_factory=list)
    grids: dict[str, bytes] = field(default_factory=dict)
    error: str | None = None
    failures: int = 0
    last_attempt: dt.datetime | None = None
    last_success: dt.datetime | None = None
    next_refresh: dt.datetime | None = None
    last_download_bytes: int = 0
    last_duration_s: float | None = None

    def frame(self, tid: str) -> Frame | None:
        return next((f for f in self.frames if f.id == tid), None)

    def nearest_frame(self, t: dt.datetime) -> Frame | None:
        if not self.frames:
            return None
        return min(self.frames, key=lambda f: abs((f.valid_time - t).total_seconds()))


class WeatherService:
    def __init__(
        self,
        fetcher: Fetcher,
        store: Store,
        products: list[ProductSpec],
        grid: MercatorGrid,
        fhours: list[int],
        policy: RefreshPolicy = RefreshPolicy(),
        concurrency: int = 4,
        base_url: str = gfs.BUCKET_URL,
        clock=lambda: dt.datetime.now(UTC),
    ) -> None:
        self.fetcher = fetcher
        self.store = store
        self.grid = grid
        self.fhours = fhours
        self.policy = policy
        self.base_url = base_url
        self.clock = clock
        self.states = {p.id: ProductState(p) for p in products}
        self._sem = asyncio.Semaphore(concurrency)
        self._idx_cache: dict[str, list[gfs.IdxEntry]] = {}
        #: In-flight raw downloads, so frames sharing a message (accumulation differences) fetch it once.
        self._raw_inflight: dict[tuple[str, str, int], asyncio.Task] = {}
        self._tasks: list[asyncio.Task] = []

    # lifecycle ---------------------------------------------------------------
    def load_cached(self) -> None:
        """Restores the last good cycle of every product from disk."""
        for state in self.states.values():
            manifest = self.store.latest_manifest(state.spec.id)
            if not manifest:
                continue
            try:
                self._install(state, manifest, {f["id"]: self.store.read_frame(state.spec.id, manifest["cycle"], f["id"]) for f in manifest["frames"]})
                state.status = "ready"
                log.info("%s: restored cycle %s from cache", state.spec.id, manifest["cycle"])
            except (KeyError, ValueError, TypeError) as err:
                log.warning("%s: cached manifest unusable: %s", state.spec.id, err)

    def start(self) -> None:
        for state in self.states.values():
            self._tasks.append(asyncio.create_task(self._run(state), name=f"refresh-{state.spec.id}"))

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

    async def _run(self, state: ProductState) -> None:
        while True:
            await self.refresh(state.spec.id)
            delay = next_refresh_delay(self.clock(), state.cycle, state.failures, self.policy)
            state.next_refresh = self.clock() + dt.timedelta(seconds=delay)
            await asyncio.sleep(delay)

    # cycle selection -----------------------------------------------------------
    async def select_cycle(self) -> dt.datetime | None:
        """Newest cycle whose inventories exist for every configured forecast hour."""
        for cycle in gfs.candidate_cycles(self.clock(), self.policy.lookback_cycles):
            urls = [gfs.idx_url(cycle, h, self.base_url) for h in self.fhours]
            present = await asyncio.gather(*(self._exists(u) for u in urls))
            if all(present):
                return cycle
            log.info("cycle %s incomplete (%d/%d forecast hours published)", gfs.cycle_token(cycle), sum(present), len(urls))
        return None

    async def _exists(self, url: str) -> bool:
        async with self._sem:
            return await self.fetcher.exists(url)

    async def _inventory(self, url: str, downloaded: list[int] | None = None) -> list[gfs.IdxEntry]:
        if url not in self._idx_cache:
            async with self._sem:
                text = await self.fetcher.get_text(url)
            if downloaded is not None:
                downloaded.append(len(text.encode()))
            if len(self._idx_cache) > 256:
                self._idx_cache.clear()
            self._idx_cache[url] = gfs.parse_idx(text)
        return self._idx_cache[url]

    # refresh -------------------------------------------------------------------
    async def refresh(self, product_id: str) -> None:
        state = self.states[product_id]
        state.last_attempt = self.clock()
        started = time.perf_counter()
        try:
            cycle = await self.select_cycle()
            if cycle is None:
                raise RuntimeError(f"no complete GFS cycle in the last {self.policy.lookback_cycles} cycles")
            if state.cycle is not None and cycle <= state.cycle:
                state.failures = 0
                state.error = None
                state.status = "ready"
                return
            state.status = "loading" if not state.frames else state.status
            token = gfs.cycle_token(cycle)
            # Bytes are counted per product: products refresh concurrently on one fetcher.
            downloaded: list[int] = []
            prev_hours = [None, *self.fhours[:-1]]
            results = await asyncio.gather(
                *(self._build_frame(state.spec, cycle, h, prev, downloaded) for h, prev in zip(self.fhours, prev_hours))
            )
            frames = [m for m, _ in results]
            manifest = {
                "product": state.spec.id,
                "cycle": token,
                "issueTime": iso(cycle),
                "generatedAt": iso(self.clock()),
                "frames": frames,
            }
            for m, data in results:
                self.store.write_frame(state.spec.id, token, m["id"], data, m)
            self.store.write_manifest(state.spec.id, token, manifest)
            self._install(state, manifest, {m["id"]: data for m, data in results})
            self.store.prune(state.spec.id)
            state.status = "ready"
            state.failures = 0
            state.error = None
            state.last_success = self.clock()
            state.last_duration_s = time.perf_counter() - started
            state.last_download_bytes = sum(downloaded)
            log.info(
                "%s: cycle %s ready (%d frames, %.1f MB downloaded, %.1fs)",
                product_id, token, len(frames), state.last_download_bytes / 1e6, state.last_duration_s,
            )
        except asyncio.CancelledError:
            raise
        except Exception as err:  # keep the last good data, report the error
            state.failures += 1
            state.error = f"{type(err).__name__}: {err}"
            state.status = "stale" if state.frames else "error"
            log.warning("%s: refresh failed (%s); keeping %s", product_id, state.error, gfs.cycle_token(state.cycle) if state.cycle else "no data")

    async def _download_raw(self, cycle: dt.datetime, fhour: int, fs: gfs.FieldSpec, downloaded: list[int]) -> bytes:
        token = gfs.cycle_token(cycle)
        raw = self.store.read_raw(token, fs.key, fhour)
        if raw is None:
            entry = gfs.find_entry(await self._inventory(gfs.idx_url(cycle, fhour, self.base_url), downloaded), fs)
            async with self._sem:
                raw = await self.fetcher.get_range(gfs.grib_url(cycle, fhour, self.base_url), entry.range_header)
            downloaded.append(len(raw))
            self.store.write_raw(token, fs.key, fhour, raw)
        return raw

    async def _fetch_field(self, cycle: dt.datetime, fhour: int, fs: gfs.FieldSpec, downloaded: list[int]):
        key = (gfs.cycle_token(cycle), fs.key, fhour)
        task = self._raw_inflight.get(key)
        if task is None:
            task = asyncio.ensure_future(self._download_raw(cycle, fhour, fs, downloaded))
            self._raw_inflight[key] = task
            task.add_done_callback(lambda _t, k=key: self._raw_inflight.pop(k, None))
        raw = await asyncio.shield(task)
        field_ = await asyncio.to_thread(decode_message, raw)
        values = await asyncio.to_thread(resample_to_mercator, field_.values, field_.grid, self.grid)
        return field_, values

    async def _build_frame(
        self, spec: ProductSpec, cycle: dt.datetime, fhour: int, prev_fhour: int | None, downloaded: list[int]
    ) -> tuple[dict, bytes]:
        extra: dict = {}
        if spec.deriver is not None:
            refs = spec.deriver.inputs(fhour, prev_fhour)
            decoded = await asyncio.gather(*(self._fetch_field(cycle, r.fhour, r.field, downloaded) for r in refs))
            inputs = {r.name: values.astype(np.float64) for r, (_, values) in zip(refs, decoded)}
            bands = spec.deriver.bands(inputs, fhour, prev_fhour)
            extra |= spec.deriver.frame_meta(fhour, prev_fhour, iso(cycle))
            source_fields = [(r.field, r.fhour) for r in refs]
        else:
            fields = spec.fields_for(fhour)
            decoded = await asyncio.gather(*(self._fetch_field(cycle, fhour, fs, downloaded) for _, fs in fields))
            bands = [(name, spec.transform(values.astype(np.float64)).astype(np.float32)) for (name, _), (_, values) in zip(fields, decoded)]
            source_fields = [(fs, fhour) for _, fs in fields]
        if len(bands) == 1:
            data, encoding = encode_uint16(bands[0][1])
        else:
            data, encoding = encode_bands(bands)
            if spec.value_kind == "vector":
                speed = wind_speed(bands[0][1], bands[1][1])
                finite = np.isfinite(speed)
                extra["speedRange"] = [float(speed[finite].min()), float(speed[finite].max())] if finite.any() else None
        valid = cycle + dt.timedelta(hours=fhour)
        meta = {
            "id": time_id(valid),
            "product": spec.id,
            "validTime": iso(valid),
            "issueTime": iso(cycle),
            "forecastHour": fhour,
            "units": spec.units,
            "sourceUnits": decoded[0][0].units,
            "bands": [name for name, _ in bands],
            "width": self.grid.width,
            "height": self.grid.height,
            "mercatorBounds": self.grid.mercator_bounds(),
            "lonLatBounds": self.grid.lonlat_bounds(),
            "encoding": encoding,
            **extra,
            "source": {
                "url": gfs.grib_url(cycle, fhour, self.base_url),
                "field": ", ".join(
                    f"{fs.variable}:{fs.level}" + (f" @f{h:03d}" if h != fhour else "") for fs, h in source_fields
                ),
            },
        }
        return meta, data

    def _install(self, state: ProductState, manifest: dict, grids: dict[str, bytes | None]) -> None:
        frames = []
        for m in manifest["frames"]:
            data = grids.get(m["id"])
            if data is None:
                raise ValueError(f"missing grid {m['id']}")
            frames.append(Frame(m["id"], dt.datetime.fromisoformat(m["validTime"].replace("Z", "+00:00")), int(m["forecastHour"]), m))
        frames.sort(key=lambda f: f.valid_time)
        # Swap in one step so readers never see a half-updated product.
        state.cycle = gfs.parse_cycle_token(manifest["cycle"])
        state.grids = {k: v for k, v in grids.items() if v is not None}
        state.frames = frames
        if state.last_success is None:
            generated = manifest.get("generatedAt")
            state.last_success = dt.datetime.fromisoformat(generated.replace("Z", "+00:00")) if generated else None

    # queries ---------------------------------------------------------------------
    def values(self, product_id: str, tid: str) -> np.ndarray | list[np.ndarray] | None:
        """Decoded grid: one array for scalar products, one array per band otherwise."""
        state = self.states[product_id]
        f = state.frame(tid)
        data = state.grids.get(tid)
        if f is None or data is None:
            return None
        shape = (f.meta["height"], f.meta["width"])
        if "bands" in f.meta["encoding"]:
            return decode_bands(data, f.meta["encoding"], shape)
        return decode_uint16(data, f.meta["encoding"], shape)

    def catalog_entry(self, state: ProductState) -> dict:
        now = self.clock()
        s = state.spec
        return {
            "id": s.id,
            "title": s.title,
            "kind": s.kind,
            "source": s.source,
            "attribution": s.attribution,
            "description": s.description,
            "units": s.units,
            "valueKind": s.value_kind,
            "bands": s.band_names,
            "displayRange": list(s.display_range),
            "valueRange": self._value_range(state),
            "bandRanges": self._band_ranges(state),
            "metadata": s.extra,
            "status": state.status,
            "error": state.error,
            "issueTime": iso(state.cycle),
            "ageSeconds": None if state.cycle is None else round((now - state.cycle).total_seconds()),
            "lastSuccess": iso(state.last_success),
            "lastAttempt": iso(state.last_attempt),
            "nextRefresh": iso(state.next_refresh),
            "lastDownloadBytes": state.last_download_bytes,
            "times": [{"id": f.id, "validTime": iso(f.valid_time), "forecastHour": f.forecast_hour} for f in state.frames],
            "grid": {
                "width": self.grid.width,
                "height": self.grid.height,
                "mercatorBounds": self.grid.mercator_bounds(),
                "lonLatBounds": self.grid.lonlat_bounds(),
            },
        }

    @staticmethod
    def _value_range(state: ProductState) -> list[float] | None:
        """Scalar: data range over all frames. Vector: wind speed range (served units)."""
        if state.spec.value_kind == "vector":
            ranges = [f.meta["speedRange"] for f in state.frames if f.meta.get("speedRange")]
        else:
            # Multi-band scalar products report their first band (e.g. precipitation rate).
            enc = [f.meta["encoding"].get("bands", [f.meta["encoding"]])[0] for f in state.frames]
            ranges = [[e["min"], e["max"]] for e in enc if e.get("min") is not None]
        return [min(r[0] for r in ranges), max(r[1] for r in ranges)] if ranges else None

    @staticmethod
    def _band_ranges(state: ProductState) -> dict[str, list[float]] | None:
        """Per-band data range over all frames, for multi-band grids."""
        out: dict[str, list[float]] = {}
        for f in state.frames:
            for b in f.meta["encoding"].get("bands", []):
                if b.get("min") is None:
                    continue
                r = out.setdefault(b["name"], [b["min"], b["max"]])
                r[0], r[1] = min(r[0], b["min"]), max(r[1], b["max"])
        return out or None


__all__ = ["WeatherService", "RefreshPolicy", "next_refresh_delay", "time_id", "NotFound"]
