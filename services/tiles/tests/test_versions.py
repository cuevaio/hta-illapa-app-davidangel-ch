"""Tileset versions never mix and are declarative."""

from __future__ import annotations

import pytest

from tiles_service.app import create_app
from tiles_service.terrarium import decode_png
from tiles_service.tilemath import lonlat_to_tile

from conftest import FakeAdapter, TEST_TILESETS, make_settings

X, Y = lonlat_to_tile(-77.0428, -12.0464, 11)


def test_version_change_does_not_mix_tiles(client, fakes, storage):
    v1 = client.get(f"/tiles/terreno/v1/11/{X}/{Y}")
    v2 = client.get(f"/tiles/terreno/v2/11/{X}/{Y}")
    assert v1.status_code == v2.status_code == 200
    assert v1.headers["x-cache"] == v2.headers["x-cache"] == "MISS"
    assert v1.headers["x-tile-version"] == "v1" and v2.headers["x-tile-version"] == "v2"
    assert decode_png(v1.content)[5, 5] == pytest.approx(100.0, abs=0.01)
    assert decode_png(v2.content)[5, 5] == pytest.approx(900.0, abs=0.01)
    assert fakes["fake"].calls == 1 and fakes["fake2"].calls == 1
    keys = sorted(k for k, _ in storage.list_prefix("terreno/"))
    assert f"terreno/v1/11/{X}/{Y}.png" in keys and f"terreno/v2/11/{X}/{Y}.png" in keys


def test_changing_the_source_of_an_existing_version_is_refused(tmp_path):
    from fastapi.testclient import TestClient

    settings = make_settings(tmp_path)
    fakes = {"fake": FakeAdapter("fake"), "fake2": FakeAdapter("fake2")}
    with TestClient(create_app(settings, adapters=fakes)) as c:
        assert c.get(f"/tiles/terreno/v1/11/{X}/{Y}").status_code == 200

    changed = TEST_TILESETS.replace("v1:\n        fuente: fake\n", "v1:\n        fuente: fake2\n", 1)
    assert changed != TEST_TILESETS
    settings2 = make_settings(tmp_path, changed)
    with TestClient(create_app(settings2, adapters=fakes)) as c:
        r = c.get(f"/tiles/terreno/v1/11/{X}/{Y}")
        assert r.status_code == 503
        assert "versión nueva" in r.json()["error"]
        salud = c.get("/salud").json()
        assert salud["estado"] == "degradado"
