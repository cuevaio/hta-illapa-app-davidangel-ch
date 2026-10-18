"""Read-through cache: generate once, then serve from storage."""

from __future__ import annotations

import httpx
import pytest

from tiles_service.app import create_app
from tiles_service.tilemath import lonlat_to_tile

from conftest import FakeAdapter, make_settings

LIMA = lonlat_to_tile(-77.0428, -12.0464, 11)
LIMA_URL = f"/tiles/terreno/v1/11/{LIMA[0]}/{LIMA[1]}"


def test_first_request_generates_and_stores_second_is_cache_hit(client, fakes, storage):
    first = client.get(LIMA_URL)
    assert first.status_code == 200
    assert first.headers["content-type"] == "image/png"
    assert first.headers["x-cache"] == "MISS"
    assert fakes["fake"].calls == 1
    assert storage.get(f"terreno/v1/11/{LIMA[0]}/{LIMA[1]}.png") == first.content

    second = client.get(LIMA_URL + ".png")
    assert second.status_code == 200
    assert second.headers["x-cache"] == "HIT"
    assert second.content == first.content
    assert fakes["fake"].calls == 1  # served from storage, no upstream call


def test_tile_headers_carry_metadata_and_immutable_cache_control(client):
    r = client.get(LIMA_URL)
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert float(r.headers["x-tile-min"]) == pytest.approx(50.0, abs=0.01)
    assert float(r.headers["x-tile-max"]) == pytest.approx(150.0, abs=0.01)
    assert r.headers["x-tile-source"] == "fake"
    assert r.headers["x-tile-version"] == "v1"
    assert r.headers["x-tile-overzoom"] == "0"
    assert r.headers["x-tile-date"].endswith("Z")
    hit = client.get(LIMA_URL)
    for h in ("x-tile-min", "x-tile-max", "x-tile-source", "x-tile-version", "x-tile-date", "x-tile-overzoom"):
        assert hit.headers[h] == r.headers[h]


@pytest.mark.anyio
async def test_fifty_concurrent_requests_make_one_upstream_call(tmp_path):
    import asyncio

    settings = make_settings(tmp_path)
    fake = FakeAdapter("fake", delay=0.2)
    app = create_app(settings, adapters={"fake": fake, "fake2": FakeAdapter("fake2")})
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        responses = await asyncio.gather(*[c.get(LIMA_URL) for _ in range(50)])
    assert [r.status_code for r in responses] == [200] * 50
    assert fake.calls == 1
    assert len({r.content for r in responses}) == 1
    assert {r.headers["x-cache"] for r in responses} <= {"MISS", "HIT"}


def test_upstream_down_with_stored_tile_serves_it(client, fakes):
    assert client.get(LIMA_URL).status_code == 200
    fakes["fake"].down = True
    r = client.get(LIMA_URL)
    assert r.status_code == 200
    assert r.headers["x-cache"] in ("HIT", "STALE")


def test_upstream_down_past_revalidation_serves_stale(tmp_path):
    from fastapi.testclient import TestClient

    from conftest import TEST_TILESETS

    text = TEST_TILESETS.replace(
        "transformacion: {tamano: 512, remuestreo: bilinear}\n      v2:",
        "transformacion: {tamano: 512, remuestreo: bilinear}\n        revalidar_tras_s: 0\n      v2:",
    )
    assert text != TEST_TILESETS
    fake = FakeAdapter("fake")
    app = create_app(make_settings(tmp_path, text), adapters={"fake": fake, "fake2": FakeAdapter("fake2")})
    with TestClient(app) as c:
        assert c.get(LIMA_URL).headers["x-cache"] == "MISS"
        fake.down = True
        r = c.get(LIMA_URL)
        assert r.status_code == 200
        assert r.headers["x-cache"] == "STALE"


def test_upstream_down_without_stored_tile_returns_clear_error(client, fakes):
    fakes["fake"].down = True
    r = client.get(LIMA_URL)
    assert r.status_code == 503
    body = r.json()
    assert set(body) == {"error"}
    assert "fuente" in body["error"].lower()


def test_missing_upstream_tile_is_negative_cached(client, fakes):
    fakes["fake"].missing = True
    assert client.get(LIMA_URL).status_code == 404
    assert client.get(LIMA_URL).status_code == 404
    assert fakes["fake"].calls == 1


def test_upstream_errors_are_not_cached(tmp_path):
    # outages are only cached briefly (TILES_OUTAGE_TTL_S, see test_resilience.py); with it off they are not cached
    from fastapi.testclient import TestClient

    fake = FakeAdapter("fake")
    app = create_app(make_settings(tmp_path, TILES_OUTAGE_TTL_S="0"), adapters={"fake": fake, "fake2": FakeAdapter("fake2")})
    with TestClient(app) as client:
        fake.down = True
        assert client.get(LIMA_URL).status_code == 503
        fake.down = False
        assert client.get(LIMA_URL).status_code == 200
        assert fake.calls == 2


def test_overzoom_levels_are_flagged(client):
    x, y = lonlat_to_tile(-77.0428, -12.0464, 13)
    r = client.get(f"/tiles/terreno/v1/13/{x}/{y}")
    assert r.status_code == 200
    assert r.headers["x-tile-overzoom"] == "1"
    x, y = lonlat_to_tile(-77.0428, -12.0464, 11)
    assert client.get(f"/tiles/terreno/v1/11/{x}/{y}").headers["x-tile-overzoom"] == "0"


def test_metrics_show_no_new_upstream_calls_on_second_visit(client):
    client.get(LIMA_URL)
    before = client.get("/metrics").text
    client.get(LIMA_URL)
    after = client.get("/metrics").text

    def value(text: str, prefix: str) -> float:
        return sum(float(line.rsplit(" ", 1)[1]) for line in text.splitlines() if line.startswith(prefix))

    assert value(before, "tiles_upstream_fetches_total") == value(after, "tiles_upstream_fetches_total") == 1
    assert value(after, 'tiles_requests_total{cache="HIT"') == 1
    assert "tiles_miss_latency_seconds_bucket" in after
    assert "tiles_cache_hit_ratio" in after
    assert "tiles_egress_bytes_total" in after
    assert "tiles_storage_bytes" in after


def test_storage_read_failure_still_serves_a_generated_tile(tmp_path):
    from fastapi.testclient import TestClient

    from tiles_service.storage import FileStorage, StorageError

    class Broken(FileStorage):
        def get(self, key):
            raise StorageError("caído")

    settings = make_settings(tmp_path)
    fake = FakeAdapter("fake")
    app = create_app(settings, storage=Broken(settings.fs_root), adapters={"fake": fake, "fake2": FakeAdapter("fake2")})
    with TestClient(app) as c:
        r = c.get(LIMA_URL)
        assert r.status_code == 200 and r.headers["x-cache"] == "MISS"
