import asyncio
import datetime as dt

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from weather_service import gfs
from weather_service.api import create_app
from weather_service.config import Settings
from weather_service.encoding import NODATA, decode_bands, encode_bands
from weather_service.grid import MercatorGrid
from weather_service.http import Fetcher
from weather_service.products import PRODUCTS, TEMPERATURE_2M, WIND_10M
from weather_service.service import RefreshPolicy, WeatherService
from weather_service.store import Store
from weather_service.wind import compass_label, ms_to_kmh, wind_direction_from, wind_speed

from .conftest import FakeClock, make_grib

UTC = dt.timezone.utc
BASE = "https://gfs.test"
C12 = dt.datetime(2026, 10, 17, 12, tzinfo=UTC)


# encoding -------------------------------------------------------------------------
def test_two_band_encoding_round_trip_with_joint_nodata():
    u = np.array([[-12.5, 0.0, 3.25], [7.0, np.nan, 1.0]], dtype=np.float32)
    v = np.array([[4.0, -20.0, 0.5], [2.0, 1.0, np.nan]], dtype=np.float32)
    data, meta = encode_bands([("u", u), ("v", v)])
    assert len(data) == 2 * u.size * 2  # two Uint16 bands, band-sequential
    assert meta["type"] == "uint16" and meta["layout"] == "band-sequential" and meta["nodata"] == NODATA
    assert [b["name"] for b in meta["bands"]] == ["u", "v"]
    du, dv = decode_bands(data, meta, u.shape)
    # A cell is missing in every band when any band is missing there.
    mask = np.isnan(u) | np.isnan(v)
    assert np.array_equal(np.isnan(du), mask) and np.array_equal(np.isnan(dv), mask)
    ok = ~mask
    assert np.allclose(du[ok], u[ok], atol=meta["bands"][0]["scale"])
    assert np.allclose(dv[ok], v[ok], atol=meta["bands"][1]["scale"])
    # Each band carries its own quantization.
    assert meta["bands"][0]["min"] == pytest.approx(-12.5) and meta["bands"][1]["min"] == pytest.approx(-20.0)


def test_two_band_encoding_all_missing():
    nan = np.full((2, 2), np.nan, dtype=np.float32)
    data, meta = encode_bands([("u", nan), ("v", nan)])
    du, dv = decode_bands(data, meta, (2, 2))
    assert np.isnan(du).all() and np.isnan(dv).all() and meta["bands"][0]["min"] is None


# wind math (meteorological convention: direction the wind comes FROM) --------------
@pytest.mark.parametrize(
    "u,v,expected",
    [
        (0.0, -5.0, 0.0),  # blowing toward the south -> from the north
        (-5.0, 0.0, 90.0),  # toward the west -> from the east
        (0.0, 5.0, 180.0),  # toward the north -> from the south
        (5.0, 0.0, 270.0),  # toward the east -> from the west
        (3.0, 3.0, 225.0),  # toward the north-east -> from the south-west
    ],
)
def test_wind_direction_from(u, v, expected):
    assert wind_direction_from(u, v) == pytest.approx(expected)


def test_wind_speed_and_units():
    assert wind_speed(3.0, 4.0) == pytest.approx(5.0)
    assert ms_to_kmh(5.0) == pytest.approx(18.0)
    assert np.allclose(wind_speed(np.array([3.0, 0.0]), np.array([4.0, -2.0])), [5.0, 2.0])


@pytest.mark.parametrize(
    "deg,label", [(0, "N"), (11.2, "N"), (11.3, "NNE"), (45, "NE"), (180, "S"), (225, "SW"), (348.8, "N"), (359.9, "N"), (292.5, "WNW")]
)
def test_compass_label(deg, label):
    assert compass_label(deg) == label


# product spec ---------------------------------------------------------------------
def test_wind_product_spec():
    assert PRODUCTS["gfs-wind10m"] is WIND_10M
    assert WIND_10M.kind == "forecast" and WIND_10M.units == "m/s" and WIND_10M.value_kind == "vector"
    names = [(n, f.variable, f.level) for n, f in WIND_10M.fields_for(0)]
    assert names == [("u", "UGRD", "10 m above ground"), ("v", "VGRD", "10 m above ground")]
    assert [n for n, _ in TEMPERATURE_2M.fields_for(0)] == ["value"] and TEMPERATURE_2M.value_kind == "scalar"
    assert Settings().products[:2] == ("gfs-t2m", "gfs-wind10m")


# service + API with a fake bucket --------------------------------------------------
U_MS, V_MS = 3.0, 4.0  # toward the north-east: 18 km/h from the SW (216.9°)


class WindBucket:
    def __init__(self) -> None:
        self.u = make_grib(lambda lon, lat: np.full(np.shape(lon), U_MS))
        self.v = make_grib(lambda lon, lat: np.full(np.shape(lon), V_MS))
        self.files: dict[str, bytes] = {}

    def publish(self, cycle: dt.datetime, fhours) -> None:
        for h in fhours:
            token = gfs.cycle_token(cycle)
            idx = (
                f"1:0:d={token}:UGRD:10 m above ground:{h} hour fcst:\n"
                f"2:{len(self.u)}:d={token}:VGRD:10 m above ground:{h} hour fcst:\n"
            )
            self.files[gfs.idx_url(cycle, h, BASE)] = idx.encode()
            self.files[gfs.grib_url(cycle, h, BASE)] = self.u + self.v

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


def wind_service(tmp_path) -> WeatherService:
    bucket = WindBucket()
    bucket.publish(C12, [0, 3])
    client = httpx.AsyncClient(transport=httpx.MockTransport(bucket.handler))
    return WeatherService(
        Fetcher(client, retries=1, backoff_s=0.01),
        Store(tmp_path),
        [WIND_10M],
        MercatorGrid.peru(32, 2.0),
        [0, 3],
        policy=RefreshPolicy(lookback_cycles=2),
        base_url=BASE,
        clock=FakeClock(dt.datetime(2026, 10, 17, 17, tzinfo=UTC)),
    )


def test_wind_refresh_catalog_and_point(tmp_path):
    svc = wind_service(tmp_path)
    asyncio.run(svc.refresh("gfs-wind10m"))
    state = svc.states["gfs-wind10m"]
    assert state.status == "ready", state.error
    meta = state.frames[0].meta
    assert meta["bands"] == ["u", "v"] and meta["units"] == "m/s"
    assert meta["speedRange"][1] == pytest.approx(5.0, abs=0.01)
    app = create_app(Settings(refresh=False, cache_dir=tmp_path), service=svc)
    with TestClient(app) as client:
        layer = client.get("/api/layers").json()["layers"][0]
        assert layer["id"] == "gfs-wind10m" and layer["valueKind"] == "vector" and layer["bands"] == ["u", "v"]
        assert layer["valueRange"][1] == pytest.approx(5.0, abs=0.01)
        res = client.get(f"/api/layers/gfs-wind10m/{meta['id']}/grid")
        assert len(res.content) == meta["width"] * meta["height"] * 2 * 2
        p = client.get("/api/layers/gfs-wind10m/point", params={"lat": -12.05, "lon": -77.04, "time": meta["id"]}).json()
        assert p["units"] == "km/h" and p["value"] == pytest.approx(18.0, abs=0.05)
        assert p["u"] == pytest.approx(U_MS, abs=0.01) and p["v"] == pytest.approx(V_MS, abs=0.01)
        assert p["directionDeg"] == pytest.approx(216.87, abs=0.2) and p["directionCompass"] == "SW"
        out = client.get("/api/layers/gfs-wind10m/point", params={"lat": 10, "lon": -77, "time": meta["id"]}).json()
        assert out["value"] is None and out["directionDeg"] is None
    # Cache restore keeps two bands.
    fresh = wind_service(tmp_path)
    fresh.load_cached()
    u, v = fresh.values("gfs-wind10m", meta["id"])
    assert np.nanmean(u) == pytest.approx(U_MS, abs=0.01) and np.nanmean(v) == pytest.approx(V_MS, abs=0.01)
