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
from weather_service.products import CAPE_SURFACE, PRODUCTS
from weather_service.service import RefreshPolicy, WeatherService
from weather_service.store import Store

from .conftest import FakeClock, make_grib

UTC = dt.timezone.utc
BASE = "https://gfs.test"
C18 = dt.datetime(2026, 10, 17, 18, tzinfo=UTC)


def idx_lines(fhour: int) -> str:
    """CAPE/CIN messages as listed in the real gfs.t18z.pgrb2.0p25 inventories (2026-10-17)."""
    fc = "anl" if fhour == 0 else f"{fhour} hour fcst"
    return (
        f"1:0:d=2026101718:CAPE:180-0 mb above ground:{fc}:\n"
        f"2:100:d=2026101718:CAPE:surface:{fc}:\n"
        f"3:200:d=2026101718:CIN:surface:{fc}:\n"
        f"4:300:d=2026101718:CAPE:90-0 mb above ground:{fc}:\n"
    )


@pytest.mark.parametrize("fhour", [0, 3, 24, 48])
def test_cape_selector_per_forecast_hour(fhour):
    entries = gfs.parse_idx(idx_lines(fhour))
    e = gfs.find_entry(entries, CAPE_SURFACE.field_for(fhour))
    assert (e.variable, e.level) == ("CAPE", "surface")
    assert e.forecast == ("anl" if fhour == 0 else f"{fhour} hour fcst")
    assert e.range_header == "bytes=100-199"


def test_cape_selector_rejects_averages():
    entries = gfs.parse_idx("1:0:d=2026101718:CAPE:surface:0-6 hour ave fcst:\n")
    with pytest.raises(LookupError):
        gfs.find_entry(entries, CAPE_SURFACE.field)


def test_cape_product_registered():
    assert PRODUCTS["gfs-cape"] is CAPE_SURFACE
    assert CAPE_SURFACE.kind == "forecast" and CAPE_SURFACE.units == "J/kg"
    assert "gfs-cape" in Settings().products
    assert "not observed" in CAPE_SURFACE.description


class CapeBucket:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    def publish(self, cycle: dt.datetime, fhours) -> None:
        for h in fhours:
            # CAPE grows 100 J/kg per forecast hour, constant in space; a decoy CIN message follows.
            cape = make_grib(lambda lon, lat, h=h: np.full(np.shape(lon), 500.0 + 100.0 * h))
            cin = make_grib(lambda lon, lat: np.full(np.shape(lon), -50.0))
            fc = "anl" if h == 0 else f"{h} hour fcst"
            tok = gfs.cycle_token(cycle)
            idx = f"1:0:d={tok}:CAPE:surface:{fc}:\n2:{len(cape)}:d={tok}:CIN:surface:{fc}:\n"
            self.files[gfs.idx_url(cycle, h, BASE)] = idx.encode()
            self.files[gfs.grib_url(cycle, h, BASE)] = cape + cin

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = self.files.get(str(request.url))
        if body is None:
            return httpx.Response(404)
        if request.method == "HEAD":
            return httpx.Response(200)
        rng = request.headers.get("range")
        if rng:
            start, _, end = rng.removeprefix("bytes=").partition("-")
            return httpx.Response(206, content=body[int(start) : (int(end) + 1 if end else None)])
        return httpx.Response(200, content=body)


def test_cape_refresh_and_point(tmp_path):
    bucket = CapeBucket()
    bucket.publish(C18, (0, 3, 6))
    client = httpx.AsyncClient(transport=httpx.MockTransport(bucket.handler))
    svc = WeatherService(
        Fetcher(client, retries=1, backoff_s=0.01),
        Store(tmp_path),
        [CAPE_SURFACE],
        MercatorGrid.peru(32, 2.0),
        [0, 3, 6],
        policy=RefreshPolicy(lookback_cycles=2),
        base_url=BASE,
        clock=FakeClock(dt.datetime(2026, 10, 17, 23, tzinfo=UTC)),
    )
    asyncio.run(svc.refresh("gfs-cape"))
    state = svc.states["gfs-cape"]
    assert state.status == "ready", state.error
    for frame in state.frames:
        values = svc.values("gfs-cape", frame.id)
        assert np.nanmean(values) == pytest.approx(500.0 + 100.0 * frame.forecast_hour, abs=0.5)
    assert state.frames[0].meta["source"]["field"] == "CAPE:surface"
    app = create_app(Settings(refresh=False, cache_dir=tmp_path), service=svc)
    with TestClient(app) as http:
        layer = http.get("/api/layers").json()["layers"][0]
        assert layer["id"] == "gfs-cape" and layer["units"] == "J/kg" and layer["kind"] == "forecast"
        p = http.get("/api/layers/gfs-cape/point", params={"lat": -9.0, "lon": -75.0, "time": state.frames[2].id}).json()
        assert p["value"] == pytest.approx(1100.0, abs=0.5) and p["units"] == "J/kg"
