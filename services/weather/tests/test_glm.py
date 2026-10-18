import datetime as dt
import io

import h5py
import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from weather_service import glm
from weather_service.api import create_app
from weather_service.config import Settings
from weather_service.http import Fetcher
from weather_service.lightning import LightningPolicy, LightningService

from .conftest import FakeClock

UTC = dt.timezone.utc
BASE = "https://goes.test"
PERU = {"west": -83.4, "south": -20.4, "east": -66.6, "north": 2.0}

# Real GLM-L2-LCFA packing (OR_GLM-L2-LCFA_G19_s2026291000000...).
TIME_SCALE, TIME_OFFSET = 0.00038148, -5.0
ENERGY_SCALE, ENERGY_OFFSET = 9.99996e-16, 2.8515e-16
AREA_SCALE = 152601.86


def _packed(f: h5py.File, name: str, values, scale: float, offset: float, units: str) -> None:
    raw = np.round((np.asarray(values, dtype=np.float64) - offset) / scale).astype(np.uint16)
    ds = f.create_dataset(name, data=raw.view(np.int16))
    ds.attrs["scale_factor"] = np.array([scale], dtype=np.float32)
    ds.attrs["add_offset"] = np.array([offset], dtype=np.float32)
    ds.attrs["_Unsigned"] = np.bytes_(b"true")
    ds.attrs["units"] = np.bytes_(units.encode())


def make_glm(start: dt.datetime, flashes: list[tuple[float, float, float, float, int]]) -> bytes:
    """GLM L2 LCFA-like NetCDF4/HDF5 file. Flashes: (lat, lon, seconds after start, energy J, quality)."""
    buf = io.BytesIO()
    with h5py.File(buf, "w") as f:
        lat = [x[0] for x in flashes]
        lon = [x[1] for x in flashes]
        f.create_dataset("flash_lat", data=np.array(lat, dtype=np.float32))
        f.create_dataset("flash_lon", data=np.array(lon, dtype=np.float32))
        units = f"seconds since {start:%Y-%m-%d %H:%M:%S}.000"
        _packed(f, "flash_time_offset_of_first_event", [x[2] for x in flashes], TIME_SCALE, TIME_OFFSET, units)
        _packed(f, "flash_time_offset_of_last_event", [x[2] + 0.2 for x in flashes], TIME_SCALE, TIME_OFFSET, units)
        _packed(f, "flash_energy", [x[3] for x in flashes], ENERGY_SCALE, ENERGY_OFFSET, "J")
        _packed(f, "flash_area", [AREA_SCALE * 10 for _ in flashes], AREA_SCALE, 0.0, "m2")
        q = f.create_dataset("flash_quality_flag", data=np.array([x[4] for x in flashes], dtype=np.uint16).view(np.int16))
        q.attrs["_Unsigned"] = np.bytes_(b"true")
        q.attrs["_FillValue"] = np.array([-1], dtype=np.int16)
        f.create_dataset("product_time", data=np.float64((start - dt.datetime(2000, 1, 1, 12, tzinfo=UTC)).total_seconds()))
        f.attrs["time_coverage_start"] = np.bytes_(f"{start:%Y-%m-%dT%H:%M:%S}.0Z".encode())
    return buf.getvalue()


def glm_key(start: dt.datetime) -> str:
    end = start + dt.timedelta(seconds=20)
    created = end + dt.timedelta(seconds=18)

    def tok(t: dt.datetime) -> str:
        return f"{t:%Y%j%H%M%S}{t.microsecond // 100000}"

    return f"{glm.hour_prefix(start)}OR_GLM-L2-LCFA_G19_s{tok(start)}_e{tok(end)}_c{tok(created)}.nc"


T0 = dt.datetime(2026, 10, 18, 0, 0, 0, tzinfo=UTC)


# parsing -------------------------------------------------------------------------
def test_parse_key_times():
    f = glm.parse_key("GLM-L2-LCFA/2026/291/00/OR_GLM-L2-LCFA_G19_s20262910000400_e20262910001000_c20262910001020.nc", 405912)
    assert f is not None
    assert f.start == dt.datetime(2026, 10, 18, 0, 0, 40, tzinfo=UTC)
    assert f.end == dt.datetime(2026, 10, 18, 0, 1, 0, tzinfo=UTC)
    assert f.size == 405912
    assert glm.parse_key("GLM-L2-LCFA/2026/291/00/readme.txt") is None


def test_hour_prefix_uses_day_of_year():
    assert glm.hour_prefix(dt.datetime(2026, 10, 18, 7, 59, tzinfo=UTC)) == "GLM-L2-LCFA/2026/291/07/"


def test_parse_listing_with_continuation():
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
        "<IsTruncated>true</IsTruncated><NextContinuationToken>abc==</NextContinuationToken>"
        f"<Contents><Key>{glm_key(T0)}</Key><Size>425393</Size></Contents>"
        "<Contents><Key>GLM-L2-LCFA/2026/291/00/other.txt</Key><Size>1</Size></Contents>"
        "</ListBucketResult>"
    )
    files, token = glm.parse_listing(xml)
    assert [f.start for f in files] == [T0] and files[0].size == 425393
    assert token == "abc=="


def test_parse_glm_decodes_packed_flashes():
    data = make_glm(T0, [(-12.05, -77.04, 3.5, 5.6e-14, 0), (-9.0, -75.0, 19.0, 3.8e-13, 3)])
    f = glm.parse_glm(data)
    assert len(f) == 2
    np.testing.assert_allclose(f.lat, [-12.05, -9.0], atol=1e-5)
    np.testing.assert_allclose(f.time - T0.timestamp(), [3.5, 19.0], atol=0.001)
    np.testing.assert_allclose(f.energy, [5.6e-14, 3.8e-13], rtol=0.02)
    assert list(f.quality) == [0, 3]
    np.testing.assert_allclose(f.area, [AREA_SCALE * 10] * 2, rtol=1e-5)


def test_parse_glm_empty_file():
    f = glm.parse_glm(make_glm(T0, []))
    assert len(f) == 0


def test_filter_keeps_good_quality_inside_bounds():
    data = make_glm(
        T0,
        [
            (-12.0, -77.0, 1.0, 1e-14, 0),  # Lima: kept
            (-12.0, -77.0, 1.0, 1e-14, 3),  # degraded: dropped
            (-12.0, -77.0, 1.0, 1e-14, 5),  # degraded: dropped
            (25.0, -90.0, 1.0, 1e-14, 0),  # Gulf of Mexico: outside
            (-30.0, -60.0, 1.0, 1e-14, 0),  # Argentina: outside
            (1.9, -66.7, 1.0, 1e-14, 0),  # inside the margin box
        ],
    )
    f = glm.filter_flashes(glm.parse_glm(data), PERU)
    assert len(f) == 2
    np.testing.assert_allclose(f.lat, [-12.0, 1.9], atol=1e-5)


# clustering ----------------------------------------------------------------------
def test_cluster_counts_per_cell_and_latest():
    lat = np.array([-12.00, -12.01, -12.02, -5.0])
    lon = np.array([-77.00, -77.01, -77.02, -75.0])
    t = np.array([100.0, 300.0, 200.0, 50.0])
    cells = glm.cluster_flashes(lat, lon, t, cell_km=25)
    assert sorted(c["count"] for c in cells) == [1, 3]
    big = next(c for c in cells if c["count"] == 3)
    assert big["latest"] == 300.0
    assert big["lat"] == pytest.approx(-12.01, abs=1e-6) and big["lon"] == pytest.approx(-77.01, abs=1e-6)


def test_cluster_cell_size_merges_at_coarse_scale():
    lat = np.array([-12.0, -12.3])
    lon = np.array([-77.0, -77.3])
    t = np.array([1.0, 2.0])
    assert len(glm.cluster_flashes(lat, lon, t, cell_km=10)) == 2
    assert len(glm.cluster_flashes(lat, lon, t, cell_km=500)) == 1
    assert glm.cluster_flashes(lat[:0], lon[:0], t[:0], cell_km=10) == []


# rolling window / incremental fetch / prune -----------------------------------------
class FakeGoes:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.requests: list[str] = []

    def publish(self, start: dt.datetime, flashes) -> str:
        key = glm_key(start)
        self.objects[key] = make_glm(start, flashes)
        return key

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        self.requests.append(str(url))
        if url.params.get("list-type") == "2":
            prefix = url.params.get("prefix", "")
            keys = sorted(k for k in self.objects if k.startswith(prefix))
            body = "".join(f"<Contents><Key>{k}</Key><Size>{len(self.objects[k])}</Size></Contents>" for k in keys)
            xml = f'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated>{body}</ListBucketResult>'
            return httpx.Response(200, content=xml.encode(), headers={"content-type": "application/xml"})
        key = url.path.lstrip("/")
        if key in self.objects:
            return httpx.Response(200, content=self.objects[key])
        return httpx.Response(404)

    def downloads(self) -> list[str]:
        return [u for u in self.requests if "list-type" not in u]


def make_lightning(goes: FakeGoes, tmp_path, clock: FakeClock, **policy) -> LightningService:
    client = httpx.AsyncClient(transport=httpx.MockTransport(goes.handler))

    async def no_sleep(_):
        return None

    return LightningService(
        Fetcher(client, retries=1, backoff_s=0.01, sleep=no_sleep),
        tmp_path / "glm",
        PERU,
        LightningPolicy(**({"window_minutes": 10, "backfill_minutes": 10} | policy)),
        base_url=BASE,
        clock=clock,
    )


def publish_every_20s(goes: FakeGoes, start: dt.datetime, minutes: int, flash_at=(-12.0, -77.0)) -> None:
    for i in range(minutes * 3):
        t = start + dt.timedelta(seconds=20 * i)
        goes.publish(t, [(flash_at[0], flash_at[1], 5.0, 1e-14, 0), (40.0, -100.0, 5.0, 1e-14, 0)])


async def test_backfill_then_incremental_then_prune(tmp_path):
    goes = FakeGoes()
    # 23:50 .. 00:10: files span two hour prefixes.
    publish_every_20s(goes, dt.datetime(2026, 10, 17, 23, 50, tzinfo=UTC), 20)
    clock = FakeClock(dt.datetime(2026, 10, 18, 0, 5, 30, tzinfo=UTC))
    svc = make_lightning(goes, tmp_path, clock)
    await svc.refresh()
    # Window 10 min: files ending after 23:55:30 and published by 00:05:30 (end <= now).
    first = len(goes.downloads())
    assert svc.status == "ready" and first == 30
    flashes = svc.window(10)
    # One Peru flash per file (the US flash is cropped); the oldest file's flash (23:55:25) is
    # just before the window start (23:55:30), so it is not reported.
    assert len(flashes) == 29
    assert svc.obs_time == dt.datetime(2026, 10, 18, 0, 5, 20, tzinfo=UTC)

    # Two minutes later only the new files are fetched.
    clock.now += dt.timedelta(minutes=2)
    await svc.refresh()
    assert len(goes.downloads()) - first == 6
    # Files that left the window are pruned from memory and disk.
    cutoff = clock.now - dt.timedelta(minutes=10)
    assert all(f.end > cutoff for f in svc.files())
    assert len(svc.files()) == 30
    assert len(list((tmp_path / "glm").glob("*.npz"))) == 30
    assert svc.window(10).time.min() >= cutoff.timestamp() - 20


async def test_window_minutes_selects_recent_flashes(tmp_path):
    goes = FakeGoes()
    publish_every_20s(goes, dt.datetime(2026, 10, 18, 0, 0, tzinfo=UTC), 10)
    clock = FakeClock(dt.datetime(2026, 10, 18, 0, 10, 0, tzinfo=UTC))
    svc = make_lightning(goes, tmp_path, clock)
    await svc.refresh()
    assert len(svc.window(10)) == 30
    assert len(svc.window(2)) == 6


async def test_cached_files_restored_without_download(tmp_path):
    goes = FakeGoes()
    publish_every_20s(goes, dt.datetime(2026, 10, 18, 0, 0, tzinfo=UTC), 5)
    clock = FakeClock(dt.datetime(2026, 10, 18, 0, 5, 0, tzinfo=UTC))
    svc = make_lightning(goes, tmp_path, clock)
    await svc.refresh()
    n = len(goes.downloads())
    again = make_lightning(goes, tmp_path, clock)
    again.load_cached()
    assert len(again.window(10)) == 15
    await again.refresh()
    assert len(goes.downloads()) == n  # nothing new to fetch


async def test_backfill_shorter_than_window_reports_coverage(tmp_path):
    goes = FakeGoes()
    publish_every_20s(goes, dt.datetime(2026, 10, 18, 0, 0, tzinfo=UTC), 10)
    clock = FakeClock(dt.datetime(2026, 10, 18, 0, 10, 0, tzinfo=UTC))
    svc = make_lightning(goes, tmp_path, clock, backfill_minutes=3)
    await svc.refresh()
    assert len(svc.window(10)) == 9
    entry = svc.catalog_entry()
    assert entry["coverageStart"] == "2026-10-18T00:07:00Z"
    assert entry["windowMinutes"] == 10


async def test_failed_listing_keeps_data_and_reports_stale(tmp_path):
    goes = FakeGoes()
    publish_every_20s(goes, dt.datetime(2026, 10, 18, 0, 0, tzinfo=UTC), 5)
    clock = FakeClock(dt.datetime(2026, 10, 18, 0, 5, 0, tzinfo=UTC))
    svc = make_lightning(goes, tmp_path, clock)
    await svc.refresh()
    goes.handler = lambda request: httpx.Response(503)  # type: ignore[method-assign]
    svc.fetcher.client = httpx.AsyncClient(transport=httpx.MockTransport(goes.handler))
    await svc.refresh()
    assert svc.status == "stale" and svc.error and len(svc.window(10)) == 15


async def test_bad_file_is_skipped(tmp_path):
    goes = FakeGoes()
    publish_every_20s(goes, dt.datetime(2026, 10, 18, 0, 0, tzinfo=UTC), 2)
    bad = glm_key(dt.datetime(2026, 10, 18, 0, 2, tzinfo=UTC))
    goes.objects[bad] = b"not hdf5"
    clock = FakeClock(dt.datetime(2026, 10, 18, 0, 3, 0, tzinfo=UTC))
    svc = make_lightning(goes, tmp_path, clock)
    await svc.refresh()
    assert svc.status == "ready" and len(svc.window(10)) == 6
    assert svc.skipped_files == 1


# API -----------------------------------------------------------------------------
async def test_lightning_api(tmp_path):
    goes = FakeGoes()
    publish_every_20s(goes, dt.datetime(2026, 10, 18, 0, 0, tzinfo=UTC), 3)
    clock = FakeClock(dt.datetime(2026, 10, 18, 0, 3, 0, tzinfo=UTC))
    svc = make_lightning(goes, tmp_path, clock)
    await svc.refresh()
    app = create_app(Settings(refresh=False, cache_dir=tmp_path, products=(), lightning=False), lightning=svc)
    with TestClient(app) as client:
        layer = next(l for l in client.get("/api/layers").json()["layers"] if l["id"] == "glm-lightning")
        assert layer["kind"] == "observed" and layer["valueKind"] == "events" and layer["times"] == []
        assert layer["obsTime"] == "2026-10-18T00:03:00Z" and layer["ageSeconds"] == 0
        assert layer["flashCount"] == 9
        body = client.get("/api/lightning", params={"minutes": 10}).json()
        assert body["count"] == 9 and len(body["flashes"]["lat"]) == 9
        assert body["windowEnd"] == "2026-10-18T00:03:00Z"
        # Seconds before windowEnd, newest last.
        ages = body["flashes"]["age"]
        assert ages == sorted(ages, reverse=True) and ages[-1] == pytest.approx(15.0, abs=0.01)
        clusters = client.get("/api/lightning/clusters", params={"minutes": 10, "cell_km": 50}).json()
        assert clusters["cells"][0]["count"] == 9
        assert client.get("/api/lightning", params={"minutes": 0}).status_code == 422
