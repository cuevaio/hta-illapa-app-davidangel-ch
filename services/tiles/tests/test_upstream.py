"""Courtesy with sources: retries with backoff, rate limit, User-Agent, budget alarms."""

from __future__ import annotations

import logging
import time

import httpx
import pytest

from tiles_service.config import SourceConfig
from tiles_service.metrics import Metrics
from tiles_service.upstream import NotFoundUpstream, TokenBucket, UnavailableUpstream, UpstreamClient


def cfg(**kw):
    base = dict(id="src", tipo="terrain_tiles", nombre="n", atribucion="a", licencia="l",
                tasa_por_s=1000, rafaga=1000, concurrencia=4, reintentos=3, espera_inicial_s=0.01)
    base.update(kw)
    return SourceConfig(**base)


@pytest.mark.anyio
async def test_retries_with_growing_backoff_then_succeeds():
    attempts = []

    def handler(request):
        attempts.append(time.monotonic())
        return httpx.Response(503 if len(attempts) < 3 else 200, content=b"ok")

    m = Metrics()
    client = UpstreamClient(cfg(), contact="c", metrics=m, transport=httpx.MockTransport(handler))
    resp = await client.get("https://x.test/a")
    assert resp.content == b"ok" and len(attempts) == 3
    gaps = [b - a for a, b in zip(attempts, attempts[1:])]
    assert gaps[1] > gaps[0]  # exponential backoff
    assert m.value("tiles_upstream_errors_total", source="src") == 2


@pytest.mark.anyio
async def test_not_found_is_not_retried_and_failures_end_unavailable():
    calls = []
    client = UpstreamClient(cfg(), contact="c", metrics=Metrics(),
                            transport=httpx.MockTransport(lambda r: calls.append(1) or httpx.Response(404)))
    with pytest.raises(NotFoundUpstream):
        await client.get("https://x.test/a")
    assert len(calls) == 1

    client = UpstreamClient(cfg(reintentos=2), contact="c", metrics=Metrics(),
                            transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    with pytest.raises(UnavailableUpstream):
        await client.get("https://x.test/a")


@pytest.mark.anyio
async def test_user_agent_is_identifiable_with_contact():
    seen = {}

    def handler(request):
        seen["ua"] = request.headers["user-agent"]
        return httpx.Response(200)

    client = UpstreamClient(cfg(), contact="ops@example.org", metrics=Metrics(), transport=httpx.MockTransport(handler))
    await client.get("https://x.test/a")
    assert seen["ua"].startswith("xr-simulator-tiles/") and "ops@example.org" in seen["ua"]


@pytest.mark.anyio
async def test_token_bucket_limits_rate():
    bucket = TokenBucket(rate=20, burst=2)
    t0 = time.monotonic()
    for _ in range(6):
        await bucket.acquire()
    elapsed = time.monotonic() - t0
    assert elapsed >= 0.18  # 4 tokens beyond the burst at 20/s


@pytest.mark.anyio
async def test_budget_alarm_logs_warning_and_sets_metric(caplog):
    m = Metrics()
    client = UpstreamClient(cfg(presupuesto={"peticiones_dia": 2}), contact="c", metrics=m,
                            transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b"x")))
    with caplog.at_level(logging.WARNING, logger="tiles"):
        for _ in range(3):
            await client.get("https://x.test/a")
    assert any("presupuesto" in r.getMessage() for r in caplog.records)
    assert m.value("tiles_budget_exceeded", source="src", kind="peticiones") == 1


@pytest.mark.anyio
async def test_budget_can_block_upstream_when_configured():
    client = UpstreamClient(cfg(presupuesto={"peticiones_dia": 1, "bloquear_al_exceder": True}), contact="c",
                            metrics=Metrics(), transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    await client.get("https://x.test/a")
    with pytest.raises(UnavailableUpstream):
        await client.get("https://x.test/a")
