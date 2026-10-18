"""Strict path validation, Peru bbox, zoom limits, CORS and per-client rate limit."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tiles_service.app import create_app
from tiles_service.tilemath import lonlat_to_tile

from conftest import FakeAdapter, make_settings

X, Y = lonlat_to_tile(-77.0428, -12.0464, 11)


def assert_json_error(r, status):
    assert r.status_code == status, r.text
    assert r.headers["content-type"].startswith("application/json")
    body = r.json()
    assert list(body) == ["error"] and isinstance(body["error"], str) and body["error"]
    return body["error"]


def test_out_of_peru_bbox_is_rejected(client, fakes):
    x, y = lonlat_to_tile(2.35, 48.85, 11)  # Paris
    msg = assert_json_error(client.get(f"/tiles/terreno/v1/11/{x}/{y}"), 404)
    assert "Perú" in msg
    assert fakes["fake"].calls == 0


@pytest.mark.parametrize("z", [15, 20])
def test_zoom_above_allowed_is_rejected(client, z):
    x, y = lonlat_to_tile(-77.0428, -12.0464, z)
    assert_json_error(client.get(f"/tiles/terreno/v1/{z}/{x}/{y}"), 404)


def test_zoom_below_layer_minimum_is_rejected(client):
    x, y = lonlat_to_tile(-77.0428, -12.0464, 5)
    assert_json_error(client.get(f"/tiles/terreno-copernicus/v1/5/{x}/{y}"), 404)


@pytest.mark.parametrize(
    "path",
    [
        "/tiles/terreno/v1/11/abc/1092",
        "/tiles/terreno/v1/11/585/-1",
        "/tiles/terreno/v1/11/0585/1092",
        "/tiles/terreno/v1/1.5/585/1092",
        "/tiles/terreno/v1/11/585/1092.jpg",
        "/tiles/terreno/v1/11/2048/1092",
        "/tiles/terreno/v1/11/585/99999999999999999999",
        "/tiles/TERRENO/v1/11/585/1092",
    ],
)
def test_invalid_parameters_are_rejected(client, fakes, path):
    assert_json_error(client.get(path), 400)
    assert fakes["fake"].calls == 0


def test_unknown_layer_and_version_are_404(client):
    assert_json_error(client.get(f"/tiles/vias/v1/11/{X}/{Y}"), 404)
    assert_json_error(client.get(f"/tiles/terreno/v9/11/{X}/{Y}"), 404)


def test_unknown_route_and_method_return_json_errors(client):
    assert_json_error(client.get("/nada"), 404)
    assert_json_error(client.post(f"/tiles/terreno/v1/11/{X}/{Y}"), 405)


def test_cors_allowlist_and_exposed_headers(client):
    ok = client.get(f"/tiles/terreno/v1/11/{X}/{Y}", headers={"Origin": "http://localhost:5173"})
    assert ok.headers["access-control-allow-origin"] == "http://localhost:5173"
    exposed = ok.headers["access-control-expose-headers"].lower()
    for h in ("x-tile-min", "x-tile-max", "x-tile-source", "x-tile-version", "x-tile-date", "x-tile-overzoom", "x-cache"):
        assert h in exposed
    bad = client.get(f"/tiles/terreno/v1/11/{X}/{Y}", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in bad.headers


def test_cors_origins_are_configurable(tmp_path):
    settings = make_settings(tmp_path, TILES_CORS_ORIGINS="https://app.example")
    with TestClient(create_app(settings, adapters={"fake": FakeAdapter("fake"), "fake2": FakeAdapter("fake2")})) as c:
        r = c.get("/capas", headers={"Origin": "https://app.example"})
        assert r.headers["access-control-allow-origin"] == "https://app.example"
        r = c.get("/capas", headers={"Origin": "http://localhost:5173"})
        assert "access-control-allow-origin" not in r.headers


def test_per_client_rate_limit(tmp_path):
    settings = make_settings(tmp_path, TILES_CLIENT_RATE="1", TILES_CLIENT_BURST="3")
    with TestClient(create_app(settings, adapters={"fake": FakeAdapter("fake"), "fake2": FakeAdapter("fake2")})) as c:
        codes = [c.get("/capas").status_code for _ in range(5)]
        assert codes[:3] == [200, 200, 200]
        assert codes[-1] == 429
        r = c.get("/capas")
        assert "retry-after" in r.headers
        assert_json_error(r, 429)
        assert c.get("/salud").status_code == 200  # health is never rate limited


def test_capas_catalog(client):
    capas = client.get("/capas").json()
    terreno = next(c for c in capas["capas"] if c["id"] == "terreno")
    v1 = next(v for v in terreno["versiones"] if v["version"] == "v1")
    assert v1["zoom_min"] == 0 and v1["zoom_max"] == 14 and v1["zoom_max_real"] == 11
    assert v1["fuente"]["id"] == "fake"
    assert v1["fuente"]["modelo_superficie"] is False
    assert v1["fuente"]["resolucion_nativa_m"] == 30
    assert v1["formato"]["codificacion"] == "terrarium"
    assert v1["formato"]["tamano_px"] == 512
    assert "atribucion" in v1["fuente"] and "licencia" in v1["fuente"]
    assert capas["bbox"] == {"oeste": -81.5, "sur": -18.5, "este": -68.5, "norte": 0.2}
    cop = next(c for c in capas["capas"] if c["id"] == "terreno-copernicus")
    assert cop["versiones"][0]["fuente"]["modelo_superficie"] is True


def test_salud(client):
    r = client.get("/salud")
    assert r.status_code == 200
    body = r.json()
    assert body["estado"] == "ok"
    assert body["almacenamiento"] == "fs"
