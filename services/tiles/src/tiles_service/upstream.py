"""HTTP access to sources: token bucket, concurrency cap, retries with backoff, User-Agent, budget."""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import email.utils
import time
from dataclasses import dataclass

import httpx

from . import __version__
from .breaker import CircuitBreaker
from .config import SourceConfig
from .logs import log
from .metrics import Metrics

RETRY_STATUS = {408, 425, 429, 500, 502, 503, 504}
MISSING_STATUS = {403, 404}  # public S3 buckets answer 403 for absent keys


class NotFoundUpstream(Exception):
    pass


class UnavailableUpstream(Exception):
    pass


class TokenBucket:
    def __init__(self, rate: float, burst: int):
        self.rate = max(rate, 1e-6)
        self.capacity = max(burst, 1)
        self.tokens = float(self.capacity)
        self.updated = time.monotonic()
        self._lock = asyncio.Lock()

    def _refill(self) -> None:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now

    def try_acquire(self) -> float:
        """Non-blocking: 0 if a token was taken, else seconds until one is available."""
        self._refill()
        if self.tokens >= 1:
            self.tokens -= 1
            return 0.0
        return (1 - self.tokens) / self.rate

    async def acquire(self) -> None:
        async with self._lock:
            while (wait := self.try_acquire()) > 0:
                await asyncio.sleep(wait)


@dataclass
class UpstreamResponse:
    status: int
    headers: httpx.Headers
    content: bytes


def user_agent(contact: str) -> str:
    return f"xr-simulator-tiles/{__version__} (contact: {contact})"


class Budget:
    """Daily request/byte budget per source: warning log + metric, optional hard block."""

    def __init__(self, cfg: SourceConfig, metrics: Metrics):
        self.source = cfg.id
        self.limits = {"peticiones": cfg.presupuesto.get("peticiones_dia"), "bytes": cfg.presupuesto.get("bytes_dia")}
        self.block = bool(cfg.presupuesto.get("bloquear_al_exceder", False))
        self.metrics = metrics
        self.day = dt.date.today()
        self.used = {"peticiones": 0, "bytes": 0}
        self.warned: set[str] = set()

    def _roll(self) -> None:
        today = dt.date.today()
        if today != self.day:
            self.day, self.used, self.warned = today, {"peticiones": 0, "bytes": 0}, set()
            for kind in self.used:
                self.metrics.budget_exceeded.labels(source=self.source, kind=kind).set(0)

    def check(self) -> None:
        self._roll()
        if self.block:
            for kind, limit in self.limits.items():
                if limit is not None and self.used[kind] >= limit:
                    raise UnavailableUpstream(f"presupuesto diario de {kind} agotado para {self.source}")

    def add(self, requests: int = 0, nbytes: int = 0) -> None:
        self._roll()
        self.used["peticiones"] += requests
        self.used["bytes"] += nbytes
        for kind, limit in self.limits.items():
            self.metrics.budget_used.labels(source=self.source, kind=kind).set(self.used[kind])
            if limit is not None and self.used[kind] > limit and kind not in self.warned:
                self.warned.add(kind)
                self.metrics.budget_exceeded.labels(source=self.source, kind=kind).set(1)
                log.warning("presupuesto diario superado", extra={"evento": "presupuesto", "fuente": self.source,
                                                                  "tipo": kind, "usado": self.used[kind], "limite": limit})


class UpstreamClient:
    def __init__(self, cfg: SourceConfig, contact: str, metrics: Metrics, transport: httpx.AsyncBaseTransport | None = None,
                 breaker: CircuitBreaker | None = None):
        self.cfg = cfg
        self.breaker = breaker
        self.metrics = metrics
        self.user_agent = user_agent(contact)
        self.bucket = TokenBucket(cfg.tasa_por_s, cfg.rafaga)
        self.semaphore = asyncio.Semaphore(max(cfg.concurrencia, 1))
        self.budget = Budget(cfg, metrics)
        self._transport = transport
        self._client: httpx.AsyncClient | None = None
        self.backoff_until = 0.0

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            kwargs = {"transport": self._transport} if self._transport else {"http2": self.cfg.http2}
            self._client = httpx.AsyncClient(
                headers={"User-Agent": self.user_agent}, follow_redirects=False,
                timeout=httpx.Timeout(self.cfg.timeout_s, connect=min(self.cfg.timeout_conexion_s, self.cfg.timeout_s)),
                limits=httpx.Limits(max_connections=max(self.cfg.concurrencia, 1), max_keepalive_connections=max(self.cfg.concurrencia, 1)),
                **kwargs,
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @contextlib.asynccontextmanager
    async def slot(self):
        """Rate-limit + concurrency slot, also used by non-httpx readers (GDAL)."""
        self._check_circuit()
        self.budget.check()
        wait = self.backoff_until - time.monotonic()
        if wait > 0:
            await asyncio.sleep(min(wait, 30))
        await self.bucket.acquire()
        async with self.semaphore:
            self._check_circuit()  # it may have opened while this request queued for a slot
            yield

    def _check_circuit(self) -> None:
        if self.breaker is not None and self.breaker.blocks_upstream():
            raise UnavailableUpstream(f"circuito abierto para {self.cfg.id}")  # stop retry loops at once

    def _delay(self, attempt: int, response: httpx.Response | None) -> float:
        delay = self.cfg.espera_inicial_s * (2**attempt)
        if response is not None and (ra := response.headers.get("retry-after")):
            with contextlib.suppress(ValueError, TypeError):
                delay = max(delay, float(ra))
            if not ra.isdigit():
                with contextlib.suppress(Exception):
                    when = email.utils.parsedate_to_datetime(ra).timestamp()
                    delay = max(delay, when - time.time())
            self.backoff_until = time.monotonic() + min(delay, 60)
        return min(delay, 60)

    def _alive(self) -> None:
        if self.breaker is not None:
            self.breaker.record_success()

    def _failed(self, started: float) -> None:
        if self.breaker is not None:
            self.breaker.record_failure(started)

    async def head(self, url: str) -> UpstreamResponse:
        return await self.request("HEAD", url)

    async def get(self, url: str, headers: dict[str, str] | None = None) -> UpstreamResponse:
        return await self.request("GET", url, headers)

    async def request(self, method: str, url: str, headers: dict[str, str] | None = None) -> UpstreamResponse:
        last = "sin respuesta"
        for attempt in range(self.cfg.reintentos + 1):
            response = None
            started = time.monotonic()
            try:
                async with self.slot():
                    response = await self.client.request(method, url, headers=headers)
                    body = response.content
                self.metrics.upstream_requests.labels(source=self.cfg.id, status=str(response.status_code)).inc()
                self.metrics.upstream_bytes.labels(source=self.cfg.id).inc(len(body))
                self.budget.add(1, len(body))
                if response.status_code in MISSING_STATUS:
                    self._alive()
                    raise NotFoundUpstream(f"{response.status_code}")
                if 200 <= response.status_code < 300 or response.status_code == 304:
                    self._alive()
                    return UpstreamResponse(response.status_code, response.headers, body)
                last = f"HTTP {response.status_code}"
                if response.status_code not in RETRY_STATUS:
                    self.metrics.upstream_errors.labels(source=self.cfg.id).inc()
                    break
                self._failed(started)
            except NotFoundUpstream:
                raise
            except UnavailableUpstream:
                raise
            except httpx.HTTPError as exc:
                self.metrics.upstream_requests.labels(source=self.cfg.id, status="error").inc()
                self.budget.add(1, 0)
                last = type(exc).__name__
                self._failed(started)
            self.metrics.upstream_errors.labels(source=self.cfg.id).inc()
            if attempt < self.cfg.reintentos:
                await asyncio.sleep(self._delay(attempt, response))
        log.warning("fuente no disponible", extra={"evento": "fuente_error", "fuente": self.cfg.id, "detalle": last})
        raise UnavailableUpstream(last)
