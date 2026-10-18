import datetime as dt

import httpx
import pytest
from fastapi.testclient import TestClient

from weather_service import gfs
from weather_service.api import create_app
from weather_service.config import Settings
from weather_service.grid import MercatorGrid
from weather_service.http import Fetcher
from weather_service.products import TEMPERATURE_2M
from weather_service.service import RefreshPolicy, WeatherService, next_refresh_delay
from weather_service.store import Store

from .conftest import FakeClock, synthetic_field

UTC = dt.timezone.utc
BASE = "https://gfs.test"
FHOURS = [0, 3, 6]


class FakeBucket:
    """In-memory GFS bucket: idx + one-message GRIB files per (cycle, fhour)."""

    def __init__(self, message: bytes) -> None:
        self.message = message
        self.files: dict[str, bytes] = {}
        self.fail_next: dict[str, list[int]] = {}
        self.requests: list[tuple[str, str]] = []

    def publish(self, cycle: dt.datetime, fhours) -> None:
        for h in fhours:
            prefix = b"\0" * 100
            idx = (
                f"1:0:d={gfs.cycle_token(cycle)}:HGT:surface:{h} hour fcst:\n"
                f"2:100:d={gfs.cycle_token(cycle)}:TMP:2 m above ground:{h} hour fcst:\n"
            )
            self.files[gfs.idx_url(cycle, h, BASE)] = idx.encode()
            self.files[gfs.grib_url(cycle, h, BASE)] = prefix + self.message

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requests.append((request.method, url))
        fails = self.fail_next.get(url)
        if fails:
            return httpx.Response(fails.pop(0))
        body = self.files.get(url)
        if body is None:
            return httpx.Response(404)
        if request.method == "HEAD":
            return httpx.Response(200)
        rng = request.headers.get("range")
        if rng:
            start, _, end = rng.removeprefix("bytes=").partition("-")
            chunk = body[int(start) : (int(end) + 1 if end else None)]
            return httpx.Response(206, content=chunk)
        return httpx.Response(200, content=body)


def make_service(bucket: FakeBucket, tmp_path, clock: FakeClock) -> WeatherService:
    client = httpx.AsyncClient(transport=httpx.MockTransport(bucket.handler))

    async def no_sleep(_):
        return None

    return WeatherService(
        Fetcher(client, retries=2, backoff_s=0.01, sleep=no_sleep),
        Store(tmp_path),
        [TEMPERATURE_2M],
        MercatorGrid.peru(48, 2.0),
        FHOURS,
        policy=RefreshPolicy(lookback_cycles=3),
        base_url=BASE,
        clock=clock,
    )


C12 = dt.datetime(2026, 10, 17, 12, tzinfo=UTC)
C18 = dt.datetime(2026, 10, 17, 18, tzinfo=UTC)


async def test_selects_newest_cycle_with_all_forecast_hours(grib_message, tmp_path):
    bucket = FakeBucket(grib_message)
    bucket.publish(C12, FHOURS)
    bucket.publish(C18, [0, 3])  # still being published
    svc = make_service(bucket, tmp_path, FakeClock(dt.datetime(2026, 10, 17, 21, 30, tzinfo=UTC)))
    assert await svc.select_cycle() == C12


async def test_refresh_downloads_ranges_and_converts_to_celsius(grib_message, tmp_path):
    bucket = FakeBucket(grib_message)
    bucket.publish(C12, FHOURS)
    svc = make_service(bucket, tmp_path, FakeClock(dt.datetime(2026, 10, 17, 17, tzinfo=UTC)))
    await svc.refresh("gfs-t2m")
    state = svc.states["gfs-t2m"]
    assert state.status == "ready" and state.error is None and state.cycle == C12
    assert [f.id for f in state.frames] == ["20261017T1200Z", "20261017T1500Z", "20261017T1800Z"]
    assert state.last_download_bytes == 3 * len(grib_message) + sum(len(bucket.files[gfs.idx_url(C12, h, BASE)]) for h in FHOURS)
    values = svc.values("gfs-t2m", "20261017T1500Z")
    from weather_service.grid import sample_mercator_grid

    v = sample_mercator_grid(values, svc.grid, -77.04, -12.05)
    assert v == pytest.approx(synthetic_field(-77.04, -12.05) - 273.15, abs=0.05)
    meta = state.frames[1].meta
    assert meta["forecastHour"] == 3 and meta["units"] == "°C" and meta["issueTime"] == "2026-10-17T12:00:00Z"
    # Raw messages were cached by cycle / field / forecast hour.
    assert svc.store.read_raw("2026101712", "tmp_2_m_above_ground", 6) == grib_message


async def test_transient_errors_are_retried(grib_message, tmp_path):
    bucket = FakeBucket(grib_message)
    bucket.publish(C12, FHOURS)
    bucket.fail_next[gfs.grib_url(C12, 3, BASE)] = [503, 500]
    svc = make_service(bucket, tmp_path, FakeClock(dt.datetime(2026, 10, 17, 17, tzinfo=UTC)))
    await svc.refresh("gfs-t2m")
    assert svc.states["gfs-t2m"].status == "ready"
    assert sum(1 for m, u in bucket.requests if m == "GET" and u == gfs.grib_url(C12, 3, BASE)) == 3


async def test_failed_refresh_keeps_last_good_data(grib_message, tmp_path):
    bucket = FakeBucket(grib_message)
    bucket.publish(C12, FHOURS)
    clock = FakeClock(dt.datetime(2026, 10, 17, 17, tzinfo=UTC))
    svc = make_service(bucket, tmp_path, clock)
    await svc.refresh("gfs-t2m")
    # A newer cycle appears but its GRIB download keeps failing.
    bucket.publish(C18, FHOURS)
    bucket.fail_next[gfs.grib_url(C18, 6, BASE)] = [503] * 10
    clock.now = dt.datetime(2026, 10, 17, 23, tzinfo=UTC)
    await svc.refresh("gfs-t2m")
    state = svc.states["gfs-t2m"]
    assert state.status == "stale" and state.failures == 1 and "503" in state.error
    assert state.cycle == C12 and len(state.frames) == 3
    # Errors back off; once fixed, the next refresh installs the new cycle.
    assert next_refresh_delay(clock.now, state.cycle, state.failures, svc.policy) == 60
    bucket.fail_next.clear()
    await svc.refresh("gfs-t2m")
    assert state.status == "ready" and state.cycle == C18 and state.failures == 0


async def test_no_complete_cycle_reports_error(grib_message, tmp_path):
    bucket = FakeBucket(grib_message)
    svc = make_service(bucket, tmp_path, FakeClock(dt.datetime(2026, 10, 17, 17, tzinfo=UTC)))
    await svc.refresh("gfs-t2m")
    state = svc.states["gfs-t2m"]
    assert state.status == "error" and "no complete GFS cycle" in state.error


async def test_cache_restores_last_good_cycle_after_restart(grib_message, tmp_path):
    bucket = FakeBucket(grib_message)
    bucket.publish(C12, FHOURS)
    clock = FakeClock(dt.datetime(2026, 10, 17, 17, tzinfo=UTC))
    await make_service(bucket, tmp_path, clock).refresh("gfs-t2m")
    fresh = make_service(FakeBucket(grib_message), tmp_path, clock)
    fresh.load_cached()
    state = fresh.states["gfs-t2m"]
    assert state.status == "ready" and state.cycle == C12 and len(state.frames) == 3
    assert fresh.values("gfs-t2m", "20261017T1800Z") is not None


def test_refresh_delay_is_aligned_to_cycle_availability():
    p = RefreshPolicy(publish_delay=dt.timedelta(hours=4), poll_interval=dt.timedelta(minutes=10))
    # 12z installed at 17:00; 18z is expected complete around 22:00.
    assert next_refresh_delay(dt.datetime(2026, 10, 17, 17, tzinfo=UTC), C12, 0, p) == 5 * 3600
    assert next_refresh_delay(dt.datetime(2026, 10, 17, 22, 30, tzinfo=UTC), C12, 0, p) == 600
    assert next_refresh_delay(dt.datetime(2026, 10, 17, 17, tzinfo=UTC), None, 0, p) == 0
    assert [next_refresh_delay(C12, C12, n, p) for n in (1, 2, 3, 10)] == [60, 120, 240, 1800]


def test_api_endpoints(grib_message, tmp_path):
    import asyncio

    bucket = FakeBucket(grib_message)
    bucket.publish(C12, FHOURS)
    svc = make_service(bucket, tmp_path, FakeClock(dt.datetime(2026, 10, 17, 17, tzinfo=UTC)))
    asyncio.run(svc.refresh("gfs-t2m"))
    app = create_app(Settings(refresh=False, cache_dir=tmp_path), service=svc)
    with TestClient(app) as client:
        cat = client.get("/api/layers").json()
        layer = cat["layers"][0]
        assert layer["id"] == "gfs-t2m" and layer["kind"] == "forecast" and layer["status"] == "ready"
        assert layer["issueTime"] == "2026-10-17T12:00:00Z" and layer["ageSeconds"] == 5 * 3600
        assert [t["forecastHour"] for t in layer["times"]] == FHOURS
        meta = client.get("/api/layers/gfs-t2m/20261017T1500Z/meta").json()
        res = client.get("/api/layers/gfs-t2m/20261017T1500Z/grid")
        assert res.status_code == 200 and len(res.content) == meta["width"] * meta["height"] * 2
        assert client.get("/api/layers/gfs-t2m/20261017T1500Z/grid", headers={"If-None-Match": res.headers["etag"]}).status_code == 304
        p = client.get("/api/layers/gfs-t2m/point", params={"lat": -12.05, "lon": -77.04, "time": "20261017T1500Z"}).json()
        assert p["value"] == pytest.approx(synthetic_field(-77.04, -12.05) - 273.15, abs=0.05) and p["units"] == "°C"
        # Nearest frame to an ISO time; outside the grid -> null value.
        p = client.get("/api/layers/gfs-t2m/point", params={"lat": 10, "lon": -77, "time": "2026-10-17T17:10:00Z"}).json()
        assert p["time"] == "20261017T1800Z" and p["value"] is None
        assert client.get("/api/layers/nope/point", params={"lat": 0, "lon": 0}).status_code == 404
        assert client.get("/api/layers/gfs-t2m/20990101T0000Z/grid").status_code == 404
