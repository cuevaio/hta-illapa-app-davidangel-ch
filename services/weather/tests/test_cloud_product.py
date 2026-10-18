"""GOES-19 cloud image as a backend product: refresh, disk cache, fallback sample, API, scheduler."""

from __future__ import annotations

import datetime as dt
import io
import json
from urllib.parse import parse_qs, urlparse

import h5py
import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from weather_service.api import create_app
from weather_service.clouds import goes_projection as gp
from weather_service.clouds.service import CLOUDS_ID, CloudPolicy, CloudService
from weather_service.config import Settings
from weather_service.http import Fetcher

from .conftest import FakeClock

UTC = dt.timezone.utc
BASE = "https://goes.test"
NOW = dt.datetime(2026, 10, 18, 12, 25, tzinfo=UTC)

# Coarse ABI fixed grid (radians) that covers Peru + margin from 75 W.
X0, DX, NX = -0.07, 0.0007, 200
Y0, DY, NY = 0.02, -0.0007, 160


def _axis(f: h5py.File, name: str, start: float, step: float, n: int) -> None:
    ds = f.create_dataset(name, data=np.arange(n, dtype=np.int16))
    ds.attrs["scale_factor"] = np.array([step], dtype=np.float64)
    ds.attrs["add_offset"] = np.array([start], dtype=np.float64)


def _base(f: h5py.File) -> None:
    p = f.create_dataset("goes_imager_projection", data=np.int32(0))
    for k, v in (
        ("perspective_point_height", 35786023.0),
        ("semi_major_axis", 6378137.0),
        ("semi_minor_axis", 6356752.31414),
        ("longitude_of_projection_origin", -75.0),
    ):
        p.attrs[k] = np.array([v])
    _axis(f, "x", X0, DX, NX)
    _axis(f, "y", Y0, DY, NY)
    f.create_dataset("DQF", data=np.zeros((NY, NX), dtype=np.uint8))


def make_mask(cloudy_west: bool = True) -> bytes:
    """ACMF-like file: cloud probability 1 on the western half of the scan, 0 elsewhere."""
    buf = io.BytesIO()
    with h5py.File(buf, "w") as f:
        _base(f)
        p = np.zeros((NY, NX), dtype=np.int16)
        if cloudy_west:
            p[:, : NX // 2] = 100
        ds = f.create_dataset("Cloud_Probabilities", data=p)
        ds.attrs["scale_factor"] = np.array([0.01])
        ds.attrs["add_offset"] = np.array([0.0])
        ds.attrs["_FillValue"] = np.array([-1], dtype=np.int16)
    return buf.getvalue()


def make_ir(bt_kelvin: float = 215.0) -> bytes:
    buf = io.BytesIO()
    with h5py.File(buf, "w") as f:
        _base(f)
        scale, offset = 0.05, 150.0
        raw = np.full((NY, NX), round((bt_kelvin - offset) / scale), dtype=np.uint16)
        ds = f.create_dataset("CMI", data=raw.view(np.int16))
        ds.attrs["scale_factor"] = np.array([scale])
        ds.attrs["add_offset"] = np.array([offset])
    return buf.getvalue()


def token(t: dt.datetime) -> str:
    return f"{t:%Y}{t.timetuple().tm_yday:03d}{t:%H%M%S}0"


def mask_key(t: dt.datetime) -> str:
    return (
        f"ABI-L2-ACMF/{t:%Y}/{t.timetuple().tm_yday:03d}/{t:%H}/"
        f"OR_ABI-L2-ACMF-M6_G19_s{token(t)}_e{token(t + dt.timedelta(minutes=9))}_c{token(t + dt.timedelta(minutes=10))}.nc"
    )


def ir_key(t: dt.datetime, band: int = 13) -> str:
    return (
        f"ABI-L2-CMIPF/{t:%Y}/{t.timetuple().tm_yday:03d}/{t:%H}/"
        f"OR_ABI-L2-CMIPF-M6C{band:02d}_G19_s{token(t)}_e{token(t + dt.timedelta(minutes=9))}_c{token(t + dt.timedelta(minutes=9))}.nc"
    )


class FakeGoes:
    """Public noaa-goes19 bucket: ListObjectsV2 XML and object GETs."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.gets: list[str] = []
        self.fail = False

    def publish(self, t: dt.datetime, ir: bool = True, cloudy_west: bool = True) -> None:
        self.objects[mask_key(t)] = make_mask(cloudy_west)
        if ir:
            self.objects[ir_key(t)] = make_ir()
            self.objects[ir_key(t, band=2)] = b"other band"

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.fail:
            return httpx.Response(503)
        url = urlparse(str(request.url))
        if url.path in ("", "/"):
            prefix = parse_qs(url.query).get("prefix", [""])[0]
            keys = sorted(k for k in self.objects if k.startswith(prefix))
            items = "".join(f"<Contents><Key>{k}</Key><Size>{len(self.objects[k])}</Size></Contents>" for k in keys)
            xml = (
                '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
                f"<IsTruncated>false</IsTruncated>{items}</ListBucketResult>"
            )
            return httpx.Response(200, text=xml)
        key = url.path.lstrip("/")
        if key not in self.objects:
            return httpx.Response(404)
        self.gets.append(key)
        return httpx.Response(200, content=self.objects[key])


def make_clouds(goes: FakeGoes, tmp_path, clock: FakeClock, settings: Settings | None = None, **policy) -> CloudService:
    settings = settings or Settings(cache_dir=tmp_path, clouds_width=96)
    client = httpx.AsyncClient(transport=httpx.MockTransport(goes.handler))

    async def no_sleep(_):
        return None

    return CloudService(
        Fetcher(client, retries=1, backoff_s=0.01, sleep=no_sleep),
        tmp_path / "clouds",
        settings.cloud_grid(),
        CloudPolicy(**policy),
        sample_dir=settings.clouds_sample_dir,
        base_url=BASE,
        clock=clock,
    )


S1 = dt.datetime(2026, 10, 18, 12, 0, 20, tzinfo=UTC)
S2 = dt.datetime(2026, 10, 18, 12, 10, 20, tzinfo=UTC)


async def test_refresh_builds_the_image_from_the_newest_scan_with_ir(tmp_path):
    goes = FakeGoes()
    goes.publish(S1)
    goes.publish(S2, ir=False)  # IR not published yet for the newest scan -> previous scan is used
    svc = make_clouds(goes, tmp_path, FakeClock(NOW))
    await svc.refresh()
    assert svc.status == "ready" and svc.error is None
    meta = svc.meta()
    assert meta["scanStart"] == "2026-10-18T12:00:20.0Z"
    assert meta["sourceKeys"] == {"mask": mask_key(S1), "ir": ir_key(S1)}
    assert meta["irBand"] == 13 and meta["maskVariable"] == "Cloud_Probabilities"
    assert meta["fallback"] is False
    assert meta["attribution"].startswith("NOAA GOES-19 ABI")
    grid = svc.grid
    assert (meta["width"], meta["height"]) == (grid.width, grid.height) == (96, grid.height)
    b = meta["lonLatBounds"]
    assert (b["west"], b["south"], b["east"], b["north"]) == pytest.approx((-83.5, -20.5, -66.5, 2.2))
    assert meta["mercatorBounds"]["minX"] == pytest.approx(grid.min_x)
    img = Image.open(io.BytesIO(svc.image_bytes()))
    assert img.mode == "LA" and img.size == (96, grid.height)
    alpha = np.asarray(img)[:, :, 1]
    # Cloud only west of 75 W (scan x < 0): the west column is opaque, the east one clear.
    assert alpha[:, 2].mean() > 100 and alpha[:, -3].max() == 0
    assert 0 < meta["alphaCoverage"] < 1
    # Cached on disk: image first, metadata last.
    files = sorted(p.name for p in (tmp_path / "clouds" / "images").iterdir())
    assert files == [f"{token(S1)}.json", f"{token(S1)}.png"]
    assert svc.last_download_bytes == len(goes.objects[mask_key(S1)]) + len(goes.objects[ir_key(S1)]) + svc.last_listing_bytes


async def test_same_scan_is_not_downloaded_again(tmp_path):
    goes = FakeGoes()
    goes.publish(S1)
    svc = make_clouds(goes, tmp_path, FakeClock(NOW))
    await svc.refresh()
    gets = len(goes.gets)
    await svc.refresh()
    assert len(goes.gets) == gets and svc.status == "ready"


async def test_mask_only_when_no_scan_has_ir(tmp_path):
    goes = FakeGoes()
    goes.publish(S2, ir=False)
    svc = make_clouds(goes, tmp_path, FakeClock(NOW))
    await svc.refresh()
    meta = svc.meta()
    assert meta["sourceKeys"] == {"mask": mask_key(S2), "ir": None} and meta["irBand"] is None


async def test_ir_can_be_disabled(tmp_path):
    goes = FakeGoes()
    goes.publish(S1)
    settings = Settings(cache_dir=tmp_path, clouds_width=64, clouds_ir=False)
    svc = make_clouds(goes, tmp_path, FakeClock(NOW), settings, ir=False)
    await svc.refresh()
    assert svc.meta()["sourceKeys"]["ir"] is None
    assert ir_key(S1) not in goes.gets


async def test_last_n_images_and_raw_files_are_kept(tmp_path):
    goes = FakeGoes()
    clock = FakeClock(NOW)
    svc = make_clouds(goes, tmp_path, clock, keep_images=2)
    scans = [S1 + dt.timedelta(minutes=10 * i) for i in range(4)]
    for s in scans:
        goes.publish(s)
        clock.now = s + dt.timedelta(minutes=12)
        await svc.refresh()
    images = sorted(p.name for p in (tmp_path / "clouds" / "images").glob("*.png"))
    assert images == [f"{token(scans[2])}.png", f"{token(scans[3])}.png"]
    # Raw NetCDF of the latest scan only (mask + IR).
    assert len(list((tmp_path / "clouds" / "raw").glob("*.nc"))) == 2
    assert [h["scanStart"] for h in svc.meta()["history"]] == [
        "2026-10-18T12:20:20.0Z",
        "2026-10-18T12:30:20.0Z",
    ]


async def test_restart_restores_the_newest_cached_image(tmp_path):
    goes = FakeGoes()
    goes.publish(S1)
    svc = make_clouds(goes, tmp_path, FakeClock(NOW))
    await svc.refresh()
    again = make_clouds(FakeGoes(), tmp_path, FakeClock(NOW))
    again.load_cached()
    assert again.status == "ready" and again.meta()["scanStart"] == "2026-10-18T12:00:20.0Z"
    assert again.image_bytes() == svc.image_bytes()


async def test_without_any_fetch_the_committed_sample_is_served(tmp_path):
    svc = make_clouds(FakeGoes(), tmp_path, FakeClock(NOW))
    svc.load_cached()
    meta = svc.meta()
    assert meta["fallback"] is True and svc.status == "idle"
    sample = json.loads((Settings().clouds_sample_dir / "sample.json").read_text())
    assert meta["scanStart"] == sample["scanStart"]
    assert meta["lonLatBounds"] == sample["lonLatBounds"]
    assert svc.image_bytes() == (Settings().clouds_sample_dir / "sample.png").read_bytes()


async def test_failures_keep_the_last_image_and_back_off(tmp_path):
    goes = FakeGoes()
    svc = make_clouds(goes, tmp_path, FakeClock(NOW), poll_seconds=600, retry_base_seconds=60, retry_max_seconds=1800)
    goes.fail = True
    await svc.refresh()
    assert svc.status == "error" and "503" in svc.error and svc.meta()["fallback"] is True
    assert svc.next_delay() == 60
    goes.fail = False
    goes.publish(S1)
    await svc.refresh()
    assert svc.status == "ready" and svc.next_delay() == 600
    goes.fail = True
    for _ in range(7):
        await svc.refresh()
    assert svc.status == "stale" and svc.meta()["scanStart"] == "2026-10-18T12:00:20.0Z"
    assert svc.next_delay() == 1800


async def test_no_scan_in_the_lookback_is_an_error(tmp_path):
    svc = make_clouds(FakeGoes(), tmp_path, FakeClock(NOW), hours_back=1)
    await svc.refresh()
    assert svc.status == "error" and "no ABI-L2-ACMF" in svc.error


async def test_cloud_api_catalog_meta_and_image(tmp_path):
    goes = FakeGoes()
    goes.publish(S1)
    svc = make_clouds(goes, tmp_path, FakeClock(NOW))
    app = create_app(Settings(refresh=False, cache_dir=tmp_path, products=(), lightning=False), clouds=svc)
    with TestClient(app) as client:
        # Never fetched: committed sample, flagged as fallback.
        before = client.get("/api/clouds").json()
        assert before["fallback"] is True and before["status"] == "idle"
        assert client.get("/api/clouds/image").content == (Settings().clouds_sample_dir / "sample.png").read_bytes()
        await svc.refresh()
        meta = client.get("/api/clouds").json()
        assert meta["fallback"] is False and meta["status"] == "ready"
        assert meta["imagePath"] == f"/api/clouds/image?scan={token(S1)}"
        res = client.get(meta["imagePath"])
        assert res.status_code == 200 and res.headers["content-type"] == "image/png"
        assert res.content == svc.image_bytes()
        etag = res.headers["etag"]
        assert client.get("/api/clouds/image", headers={"If-None-Match": etag}).status_code == 304
        assert client.get("/api/clouds/image", params={"scan": "20260010000000"}).status_code == 404
        layer = next(l for l in client.get("/api/layers").json()["layers"] if l["id"] == CLOUDS_ID)
        assert layer["kind"] == "observed" and layer["valueKind"] == "image" and layer["times"] == []
        assert layer["obsTime"] == "2026-10-18T12:00:20Z" and layer["attribution"].startswith("NOAA GOES-19 ABI")
        assert layer["ageSeconds"] == round((NOW - S1).total_seconds())
        assert client.get("/api/health").json()["layers"][CLOUDS_ID] == "ready"


async def test_scheduler_runs_refresh_and_sets_next_refresh(tmp_path):
    goes = FakeGoes()
    goes.publish(S1)
    svc = make_clouds(goes, tmp_path, FakeClock(NOW), poll_seconds=600)
    svc.start()
    try:
        for _ in range(200):
            if svc.next_refresh is not None:
                break
            import asyncio

            await asyncio.sleep(0.02)
    finally:
        await svc.stop()
    assert svc.status == "ready" and svc.next_refresh == NOW + dt.timedelta(seconds=600)


def test_projection_of_synthetic_grid_covers_peru():
    # Guard for the fixture: every corner of the output extent is inside the synthetic scan.
    for lon, lat in ((-83.5, -20.5), (-66.5, 2.2), (-83.5, 2.2), (-66.5, -20.5)):
        x, y, visible = gp.lonlat_to_scan(gp.GOES_EAST, lon, lat)
        assert bool(visible)
        assert X0 < float(x) < X0 + DX * (NX - 1)
        assert Y0 + DY * (NY - 1) < float(y) < Y0
