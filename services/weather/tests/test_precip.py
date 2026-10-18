import asyncio
import datetime as dt

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from weather_service import gfs
from weather_service.api import create_app
from weather_service.config import Settings
from weather_service.grid import MercatorGrid
from weather_service.http import Fetcher
from weather_service.precip import (
    PRATE_ANALYSIS,
    apcp_running_total,
    mean_rate_from_accumulation,
    prate_to_mm_per_hour,
)
from weather_service.products import PRECIPITATION, PRODUCTS
from weather_service.service import RefreshPolicy, WeatherService
from weather_service.store import Store

from .conftest import FakeClock, make_grib

UTC = dt.timezone.utc
BASE = "https://gfs.test"
C18 = dt.datetime(2026, 10, 17, 18, tzinfo=UTC)

# Precipitation lines copied from the real gfs.t18z.pgrb2.0p25 inventories of 2026-10-17.
REAL_IDX = {
    0: "588:420000000:d=2026101718:TMP:2 m above ground:anl:\n"
    "589:421371614:d=2026101718:PRATE:surface:anl:\n"
    "590:422058623:d=2026101718:CAPE:surface:anl:\n",
    3: "592:423482134:d=2026101718:CPRAT:surface:3 hour fcst:\n"
    "593:424159843:d=2026101718:PRATE:surface:3 hour fcst:\n"
    "594:424845426:d=2026101718:CPRAT:surface:0-3 hour ave fcst:\n"
    "595:425568912:d=2026101718:PRATE:surface:0-3 hour ave fcst:\n"
    "596:426267432:d=2026101718:APCP:surface:0-3 hour acc fcst:\n"
    "597:426579706:d=2026101718:APCP:surface:0-3 hour acc fcst:\n"
    "598:426891980:d=2026101718:ACPCP:surface:0-3 hour acc fcst:\n",
    6: "593:425021012:d=2026101718:PRATE:surface:6 hour fcst:\n"
    "595:426328444:d=2026101718:PRATE:surface:0-6 hour ave fcst:\n"
    "596:427047186:d=2026101718:APCP:surface:0-6 hour acc fcst:\n"
    "597:427411599:d=2026101718:APCP:surface:0-6 hour acc fcst:\n"
    "598:427776012:d=2026101718:ACPCP:surface:0-6 hour acc fcst:\n",
    9: "593:428956367:d=2026101718:PRATE:surface:9 hour fcst:\n"
    "595:430261905:d=2026101718:PRATE:surface:6-9 hour ave fcst:\n"
    "596:430872775:d=2026101718:APCP:surface:6-9 hour acc fcst:\n"
    "597:431182075:d=2026101718:APCP:surface:0-9 hour acc fcst:\n"
    "598:431585387:d=2026101718:ACPCP:surface:6-9 hour acc fcst:\n",
    12: "596:434430515:d=2026101718:APCP:surface:6-12 hour acc fcst:\n"
    "597:434796657:d=2026101718:APCP:surface:0-12 hour acc fcst:\n",
    21: "596:431000000:d=2026101718:APCP:surface:18-21 hour acc fcst:\n"
    "597:431300000:d=2026101718:APCP:surface:0-21 hour acc fcst:\n",
    # wgrib2 writes whole days as "N day": the f024 / f048 running totals are "0-1 day" / "0-2 day".
    24: "595:431443418:d=2026101718:PRATE:surface:18-24 hour ave fcst:\n"
    "596:432160242:d=2026101718:APCP:surface:18-24 hour acc fcst:\n"
    "597:432528203:d=2026101718:APCP:surface:0-1 day acc fcst:\n",
    48: "595:425139784:d=2026101718:PRATE:surface:42-48 hour ave fcst:\n"
    "596:425823354:d=2026101718:APCP:surface:42-48 hour acc fcst:\n"
    "597:426190642:d=2026101718:APCP:surface:0-2 day acc fcst:\n",
}


# unit conversion ------------------------------------------------------------------
def test_prate_kg_m2_s_to_mm_per_hour():
    # 1 kg m^-2 of water is 1 mm; 1 kg m^-2 s^-1 = 3600 mm/h.
    assert prate_to_mm_per_hour(np.array([1.0 / 3600.0]))[0] == pytest.approx(1.0)
    assert prate_to_mm_per_hour(np.array([2.5e-4]))[0] == pytest.approx(0.9)
    # Tiny negative packing noise is clipped; missing stays missing.
    out = prate_to_mm_per_hour(np.array([-1e-9, np.nan]))
    assert out[0] == 0.0 and np.isnan(out[1])


def test_mean_rate_from_accumulation_differences_running_totals():
    acc = np.array([9.0, 4.0, 1.0, np.nan])
    prev = np.array([3.0, 4.0, 1.5, 2.0])
    rate = mean_rate_from_accumulation(acc, prev, 3)
    assert rate[0] == pytest.approx(2.0) and rate[1] == 0.0
    assert rate[2] == 0.0  # a negative difference is packing noise, never negative rain
    assert np.isnan(rate[3])
    # Without a previous total the window starts at the cycle (0 mm).
    assert mean_rate_from_accumulation(np.array([6.0]), None, 6)[0] == pytest.approx(1.0)
    with pytest.raises(ValueError):
        mean_rate_from_accumulation(acc, prev, 0)


# idx selection --------------------------------------------------------------------
def select(fhour: int, prev: int | None):
    refs = PRECIPITATION.deriver.inputs(fhour, prev)
    return [(r.name, r.fhour, gfs.find_entry(gfs.parse_idx(REAL_IDX[r.fhour]), r.field)) for r in refs]


def test_f000_uses_the_instantaneous_prate_analysis():
    [(name, fhour, entry)] = select(0, None)
    assert (name, fhour, entry.number, entry.variable, entry.forecast) == ("prate", 0, "589", "PRATE", "anl")
    assert PRATE_ANALYSIS.variable == "PRATE"


@pytest.mark.parametrize(
    "fhour,prev,expected",
    [
        # (name, file fhour, idx message number, forecast description)
        (3, 0, [("acc", 3, "596", "0-3 hour acc fcst")]),
        (6, 3, [("acc", 6, "596", "0-6 hour acc fcst"), ("acc_prev", 3, "596", "0-3 hour acc fcst")]),
        # f009 has a 6-9 h bucket first: the running total 0-9 h must be chosen.
        (9, 6, [("acc", 9, "597", "0-9 hour acc fcst"), ("acc_prev", 6, "596", "0-6 hour acc fcst")]),
        (12, 9, [("acc", 12, "597", "0-12 hour acc fcst"), ("acc_prev", 9, "597", "0-9 hour acc fcst")]),
        # A sparser timeline still differences consecutive served frames.
        (12, 6, [("acc", 12, "597", "0-12 hour acc fcst"), ("acc_prev", 6, "596", "0-6 hour acc fcst")]),
        (24, 21, [("acc", 24, "597", "0-1 day acc fcst"), ("acc_prev", 21, "597", "0-21 hour acc fcst")]),
        (48, 24, [("acc", 48, "597", "0-2 day acc fcst"), ("acc_prev", 24, "597", "0-1 day acc fcst")]),
    ],
)
def test_selects_running_total_apcp_messages(fhour, prev, expected):
    got = [(n, h, e.number, e.forecast) for n, h, e in select(fhour, prev)]
    assert got == expected
    assert all(e.variable == "APCP" for _, _, e in select(fhour, prev))


def test_running_total_selector_never_matches_buckets_or_prate():
    entries = gfs.parse_idx(REAL_IDX[9])
    spec = apcp_running_total(9)
    assert [e.number for e in entries if spec.matches(e)] == ["597"]
    assert not apcp_running_total(6).matches(entries[2])  # "6-9 hour acc" is not "0-6"


def test_field_cache_key_distinguishes_forecast_selectors():
    assert gfs.FieldSpec("TMP", "2 m above ground").key == "tmp_2_m_above_ground"
    assert apcp_running_total(9).key != apcp_running_total(6).key
    assert apcp_running_total(9).key.startswith("apcp_surface_")


def test_precipitation_product_spec():
    assert PRODUCTS["gfs-precip"] is PRECIPITATION
    assert PRECIPITATION.kind == "forecast" and PRECIPITATION.units == "mm/h"
    assert PRECIPITATION.band_names == ["rate", "accum"]
    meta = PRECIPITATION.extra
    assert meta["bands"]["rate"]["units"] == "mm/h" and meta["bands"]["accum"]["units"] == "mm"
    assert "3-hour" in meta["bands"]["rate"]["definition"] and "cycle start" in meta["bands"]["accum"]["definition"]
    assert "gfs-precip" in Settings().products


# service + API with a fake bucket -------------------------------------------------
def const_grib(value: float) -> bytes:
    return make_grib(lambda lon, lat: np.full(np.shape(lon), value))


class PrecipBucket:
    """Running total grows 2 mm/h; buckets and averages hold decoy values."""

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}
        self.ranges: list[str] = []

    def publish(self, cycle: dt.datetime, fhours) -> None:
        token = gfs.cycle_token(cycle)
        for h in fhours:
            if h == 0:
                msgs = [("PRATE:surface:anl", const_grib(1.0 / 3600.0)), ("TMP:2 m above ground:anl", const_grib(280.0))]
            else:
                start = h - 3 if h % 6 else h - 6
                msgs = [
                    (f"PRATE:surface:{h} hour fcst", const_grib(50.0 / 3600.0)),
                    (f"PRATE:surface:{start}-{h} hour ave fcst", const_grib(77.0 / 3600.0)),
                    (f"APCP:surface:{start}-{h} hour acc fcst", const_grib(999.0 if start else 2.0 * h)),
                    (f"APCP:surface:0-{h} hour acc fcst", const_grib(2.0 * h)),
                ]
            lines, body, offset = [], b"", 0
            for i, (desc, data) in enumerate(msgs, 1):
                lines.append(f"{i}:{offset}:d={token}:{desc}:")
                body += data
                offset += len(data)
            self.files[gfs.idx_url(cycle, h, BASE)] = ("\n".join(lines) + "\n").encode()
            self.files[gfs.grib_url(cycle, h, BASE)] = body

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = self.files.get(str(request.url))
        if body is None:
            return httpx.Response(404)
        if request.method == "HEAD":
            return httpx.Response(200)
        rng = request.headers.get("range")
        if rng:
            self.ranges.append(f"{request.url.path}:{rng}")
            start, _, end = rng.removeprefix("bytes=").partition("-")
            return httpx.Response(206, content=body[int(start) : (int(end) + 1 if end else None)])
        return httpx.Response(200, content=body)


def precip_service(tmp_path, bucket: PrecipBucket, fhours=(0, 3, 6, 9)) -> WeatherService:
    bucket.publish(C18, fhours)
    client = httpx.AsyncClient(transport=httpx.MockTransport(bucket.handler))
    return WeatherService(
        Fetcher(client, retries=1, backoff_s=0.01),
        Store(tmp_path),
        [PRECIPITATION],
        MercatorGrid.peru(32, 2.0),
        list(fhours),
        policy=RefreshPolicy(lookback_cycles=2),
        base_url=BASE,
        clock=FakeClock(dt.datetime(2026, 10, 17, 23, tzinfo=UTC)),
    )


def test_precip_refresh_bands_and_definitions(tmp_path):
    bucket = PrecipBucket()
    svc = precip_service(tmp_path, bucket)
    asyncio.run(svc.refresh("gfs-precip"))
    state = svc.states["gfs-precip"]
    assert state.status == "ready", state.error
    expected = {0: (1.0, 0.0), 3: (2.0, 6.0), 6: (2.0, 12.0), 9: (2.0, 18.0)}
    for frame in state.frames:
        rate, accum = svc.values("gfs-precip", frame.id)
        r, a = expected[frame.forecast_hour]
        assert np.nanmean(rate) == pytest.approx(r, abs=0.01) and np.nanmax(rate) == pytest.approx(r, abs=0.01)
        assert np.nanmean(accum) == pytest.approx(a, abs=0.01)
        assert frame.meta["bands"] == ["rate", "accum"] and frame.meta["units"] == "mm/h"
    m0, m9 = state.frames[0].meta, state.frames[3].meta
    assert m0["rate"]["method"] == "instantaneous-analysis" and m0["rate"]["windowHours"] == [0, 0]
    assert m9["rate"]["method"] == "mean-of-accumulation" and m9["rate"]["windowHours"] == [6, 9]
    assert m9["accumulation"]["windowHours"] == [0, 9] and m9["accumulation"]["since"] == "2026-10-17T18:00:00Z"
    # Each running-total message is downloaded once even though two frames need it.
    apcp_ranges = [r for r in bucket.ranges if "f000" not in r]
    assert len(apcp_ranges) == len(set(apcp_ranges)) == 3


def test_precip_catalog_and_point_query(tmp_path):
    svc = precip_service(tmp_path, PrecipBucket())
    asyncio.run(svc.refresh("gfs-precip"))
    tid = svc.states["gfs-precip"].frames[2].id  # f006
    app = create_app(Settings(refresh=False, cache_dir=tmp_path), service=svc)
    with TestClient(app) as client:
        layer = client.get("/api/layers").json()["layers"][0]
        assert layer["id"] == "gfs-precip" and layer["kind"] == "forecast" and layer["bands"] == ["rate", "accum"]
        assert layer["metadata"]["bands"]["accum"]["units"] == "mm"
        assert layer["bandRanges"]["rate"][1] == pytest.approx(2.0, abs=0.01)
        assert layer["bandRanges"]["accum"][1] == pytest.approx(18.0, abs=0.01)
        assert layer["valueRange"][1] == pytest.approx(2.0, abs=0.01)
        p = client.get("/api/layers/gfs-precip/point", params={"lat": -3.75, "lon": -73.25, "time": tid}).json()
        assert p["kind"] == "forecast" and p["units"] == "mm/h"
        assert p["value"] == pytest.approx(2.0, abs=0.01)
        assert p["bands"]["rate"] == pytest.approx(2.0, abs=0.01) and p["bands"]["accum"] == pytest.approx(12.0, abs=0.01)
        out = client.get("/api/layers/gfs-precip/point", params={"lat": 10, "lon": -77, "time": tid}).json()
        assert out["value"] is None and out["bands"]["accum"] is None
    fresh = precip_service(tmp_path, PrecipBucket())
    fresh.load_cached()
    rate, accum = fresh.values("gfs-precip", tid)
    assert np.nanmean(accum) == pytest.approx(12.0, abs=0.01)
