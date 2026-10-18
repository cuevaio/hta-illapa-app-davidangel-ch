"""Fast, polite failure when a source is down: circuit breaker, generation deadline, brief outage cache."""

from __future__ import annotations

import time

import httpx
import pytest
from fastapi.testclient import TestClient

from tiles_service.app import create_app
from tiles_service.breaker import CircuitBreaker
from tiles_service.config import SourceConfig
from tiles_service.metrics import Metrics
from tiles_service.tilemath import lonlat_to_tile
from tiles_service.upstream import UnavailableUpstream, UpstreamClient

from conftest import TEST_TILESETS, FakeAdapter, make_settings

LX, LY = lonlat_to_tile(-77.0428, -12.0464, 11)
URLS = [f"/tiles/terreno/v1/11/{LX + i}/{LY}" for i in range(4)]
MESSAGE = "La fuente no está disponible y el tile no está en caché"


def make_client(tmp_path, fake, text=TEST_TILESETS, **env):
    settings = make_settings(tmp_path, text, **env)
    app = create_app(settings, adapters={"fake": fake, "fake2": FakeAdapter("fake2")})
    return TestClient(app)


def timed(client, url):
    t0 = time.monotonic()
    r = client.get(url)
    return r, time.monotonic() - t0


def metric(text: str, prefix: str) -> float:
    return sum(float(line.rsplit(" ", 1)[1]) for line in text.splitlines() if line.startswith(prefix))


def test_generation_deadline_answers_503_in_time_when_source_hangs(tmp_path):
    fake = FakeAdapter("fake", delay=30)
    with make_client(tmp_path, fake, TILES_GENERATION_DEADLINE_S="0.2") as c:
        r, elapsed = timed(c, URLS[0])
        assert r.status_code == 503 and r.json() == {"error": MESSAGE}
        assert elapsed < 2
        assert "Retry-After" in r.headers
        assert metric(c.get("/metrics").text, 'tiles_generation_timeouts_total{source="fake"}') == 1


def test_breaker_opens_after_consecutive_failures_and_answers_immediately(tmp_path):
    fake = FakeAdapter("fake", delay=30)
    with make_client(tmp_path, fake, TILES_GENERATION_DEADLINE_S="0.2", TILES_CIRCUIT_FAILURES="2",
                     TILES_CIRCUIT_COOLDOWN_S="60") as c:
        for url in URLS[:2]:
            assert c.get(url).status_code == 503
        assert fake.calls == 2
        r, elapsed = timed(c, URLS[2])
        assert r.status_code == 503 and r.json() == {"error": MESSAGE}
        assert elapsed < 0.15
        assert fake.calls == 2  # the source is not contacted while the circuit is open
        assert 1 <= int(r.headers["Retry-After"]) <= 60
        salud = c.get("/salud").json()
        assert salud["fuentes"]["fake"]["circuito"] == "abierto"
        assert salud["fuentes"]["fake"]["fallos_consecutivos"] == 2
        assert salud["fuentes"]["fake2"]["circuito"] == "cerrado"
        assert salud["estado"] == "degradado"
        text = c.get("/metrics").text
        assert metric(text, 'tiles_circuit_state{source="fake"}') == 2
        assert metric(text, 'tiles_circuit_state{source="fake2"}') == 0
        assert metric(text, 'tiles_circuit_opened_total{source="fake"}') == 1
        assert metric(text, 'tiles_fast_failures_total{reason="circuito",source="fake"}') == 1


def test_half_open_probe_recovers_or_reopens(tmp_path):
    fake = FakeAdapter("fake")
    fake.down = True
    with make_client(tmp_path, fake, TILES_CIRCUIT_FAILURES="1", TILES_CIRCUIT_COOLDOWN_S="0.3",
                     TILES_OUTAGE_TTL_S="0") as c:
        assert c.get(URLS[0]).status_code == 503
        assert c.get(URLS[1]).status_code == 503 and fake.calls == 1  # open: rejected without a call
        time.sleep(0.35)
        assert c.get(URLS[1]).status_code == 503 and fake.calls == 2  # half-open probe failed -> open again
        assert c.get("/salud").json()["fuentes"]["fake"]["circuito"] == "abierto"
        assert c.get(URLS[2]).status_code == 503 and fake.calls == 2
        time.sleep(0.35)
        fake.down = False
        r = c.get(URLS[2])
        assert r.status_code == 200 and r.headers["x-cache"] == "MISS"
        salud = c.get("/salud").json()
        assert salud["fuentes"]["fake"]["circuito"] == "cerrado" and salud["estado"] == "ok"
        assert c.get(URLS[3]).status_code == 200


def test_stored_tiles_are_served_while_the_circuit_is_open(tmp_path):
    text = TEST_TILESETS.replace(
        "transformacion: {tamano: 512, remuestreo: bilinear}\n      v2:",
        "transformacion: {tamano: 512, remuestreo: bilinear}\n        revalidar_tras_s: 0\n      v2:",
    )
    fake = FakeAdapter("fake")
    with make_client(tmp_path, fake, text, TILES_CIRCUIT_FAILURES="1", TILES_CIRCUIT_COOLDOWN_S="60") as c:
        assert c.get(URLS[0]).headers["x-cache"] == "MISS"
        fake.down = True
        assert c.get(URLS[1]).status_code == 503
        calls = fake.calls
        r, elapsed = timed(c, URLS[0])
        assert r.status_code == 200 and r.headers["x-cache"] == "STALE"
        assert fake.calls == calls and elapsed < 0.5  # no revalidation attempt while open


def test_outage_failures_are_cached_briefly_and_expire(tmp_path):
    fake = FakeAdapter("fake")
    fake.down = True
    with make_client(tmp_path, fake, TILES_OUTAGE_TTL_S="0.3", TILES_CIRCUIT_FAILURES="100") as c:
        assert c.get(URLS[0]).status_code == 503
        fake.down = False
        r, elapsed = timed(c, URLS[0])
        assert r.status_code == 503 and r.json() == {"error": MESSAGE}
        assert fake.calls == 1 and elapsed < 0.15
        assert "Retry-After" in r.headers
        assert metric(c.get("/metrics").text, 'tiles_fast_failures_total{reason="caida_reciente",source="fake"}') == 1
        time.sleep(0.35)
        assert c.get(URLS[0]).status_code == 200
        assert fake.calls == 2


def test_failures_that_started_before_a_later_success_do_not_count():
    b = CircuitBreaker("s", failures=2, cooldown_s=60)
    started = time.monotonic()
    b.acquire()
    b.record_success()
    assert b.record_failure(started) is False  # source answered meanwhile: congestion, not an outage
    assert b.record_failure(time.monotonic()) is True
    assert b.state == "cerrado" and b.consecutive == 1


def test_upstream_client_uses_a_short_connect_timeout_and_stops_retrying_when_open():
    calls = []
    cfg = SourceConfig(id="src", tipo="terrain_tiles", nombre="n", atribucion="a", licencia="l", tasa_por_s=1000,
                       rafaga=1000, reintentos=3, espera_inicial_s=0.01, timeout_s=20, timeout_conexion_s=2.5)
    breaker = CircuitBreaker("src", failures=1, cooldown_s=60)
    client = UpstreamClient(cfg, contact="c", metrics=Metrics(), breaker=breaker,
                            transport=httpx.MockTransport(lambda r: calls.append(1) or httpx.Response(200)))
    assert client.client.timeout.connect == 2.5 and client.client.timeout.read == 20
    breaker.acquire()
    breaker.record_failure(time.monotonic())
    with pytest.raises(UnavailableUpstream):
        import asyncio

        asyncio.run(client.get("https://x.test/a"))
    assert calls == []


def test_transport_failures_feed_the_breaker_and_cut_retries_short():
    import asyncio

    calls = []

    def handler(request):
        calls.append(1)
        raise httpx.ConnectError("sin ruta")

    cfg = SourceConfig(id="src", tipo="terrain_tiles", nombre="n", atribucion="a", licencia="l", tasa_por_s=1000,
                       rafaga=1000, reintentos=5, espera_inicial_s=0.01)
    breaker = CircuitBreaker("src", failures=2, cooldown_s=60)
    client = UpstreamClient(cfg, contact="c", metrics=Metrics(), breaker=breaker, transport=httpx.MockTransport(handler))
    with pytest.raises(UnavailableUpstream):
        asyncio.run(client.get("https://x.test/a"))
    assert len(calls) == 2 and breaker.state == "abierto"  # not 6 attempts: the open circuit stops the retry loop

    ok = UpstreamClient(cfg, contact="c", metrics=Metrics(), breaker=CircuitBreaker("src", failures=2),
                        transport=httpx.MockTransport(lambda r: httpx.Response(404)))
    ok.breaker.record_failure(time.monotonic())
    from tiles_service.upstream import NotFoundUpstream

    with pytest.raises(NotFoundUpstream):
        asyncio.run(ok.get("https://x.test/a"))
    assert ok.breaker.consecutive == 0  # a 404 proves the source is reachable


def test_a_failed_request_during_half_open_reopens_once():
    b = CircuitBreaker("s", failures=1, cooldown_s=0)
    b.acquire()
    b.record_failure(time.monotonic())
    assert b.state in ("abierto", "semiabierto") and b.openings == 1
    probe = b.acquire()  # cool-down 0: half-open probe
    assert probe is True and b.state == "semiabierto"
    b.record_failure(time.monotonic())  # one of the probe's HTTP requests failed
    b.record_failure(time.monotonic(), probe=True)  # then the probe generation itself
    assert b.openings == 2


def test_requests_queued_for_a_slot_do_not_reach_the_source_once_the_circuit_opens():
    import asyncio

    calls = []

    async def handler(request):
        calls.append(1)
        await asyncio.sleep(0.05)
        raise httpx.ConnectTimeout("sin respuesta")

    cfg = SourceConfig(id="src", tipo="terrain_tiles", nombre="n", atribucion="a", licencia="l", tasa_por_s=1000,
                       rafaga=1000, concurrencia=2, reintentos=0, espera_inicial_s=0.01)
    breaker = CircuitBreaker("src", failures=2, cooldown_s=60)
    client = UpstreamClient(cfg, contact="c", metrics=Metrics(), breaker=breaker, transport=httpx.MockTransport(handler))

    async def burst():
        return await asyncio.gather(*(client.get(f"https://x.test/{i}") for i in range(10)), return_exceptions=True)

    results = asyncio.run(burst())
    assert all(isinstance(r, UnavailableUpstream) for r in results)
    assert len(calls) == 2  # the 8 queued behind the concurrency cap never left
