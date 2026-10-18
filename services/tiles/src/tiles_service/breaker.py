"""Per-source circuit breaker: stop hammering a source that is down and answer uncached tiles at once.

States (Spanish, as exposed in /salud): ``cerrado`` (normal), ``abierto`` (source considered down: no
upstream calls, uncached tiles answer 503 immediately), ``semiabierto`` (cool-down elapsed: exactly one
probe generation may reach the source; success closes the circuit, failure reopens it).

A failure only counts when no success happened since that generation started: a tile that timed out
while other tiles kept arriving means congestion (queue behind the rate limit), not an outage.
"""

from __future__ import annotations

import math
import time
from collections.abc import Callable

from .logs import log

STATE_CODE = {"cerrado": 0, "semiabierto": 1, "abierto": 2}


class CircuitOpen(Exception):
    def __init__(self, source: str, retry_after: float):
        super().__init__(f"circuito abierto para {source}")
        self.retry_after = retry_after


class CircuitBreaker:
    def __init__(self, source: str, failures: int = 5, cooldown_s: float = 30.0,
                 on_change: Callable[["CircuitBreaker"], None] | None = None):
        self.source = source
        self.threshold = max(int(failures), 1)
        self.cooldown_s = max(float(cooldown_s), 0.0)
        self.on_change = on_change
        self.state = "cerrado"
        self.consecutive = 0
        self.opened_at = 0.0
        self.openings = 0
        self.last_success = -math.inf
        self._probing = False

    # ------------------------------------------------------------------ queries
    def retry_after(self) -> float:
        """Seconds until a probe is allowed (0 when closed)."""
        if self.state == "cerrado":
            return 0.0
        return max(self.opened_at + self.cooldown_s - time.monotonic(), 0.0)

    def blocks_upstream(self) -> bool:
        """True while open and still cooling down: upstream clients must not send requests."""
        return self.state == "abierto" and self.retry_after() > 0

    def snapshot(self) -> dict:
        self._tick()
        wait = self.retry_after()
        return {"circuito": self.state, "fallos_consecutivos": self.consecutive, "aperturas": self.openings,
                "reintento_en_s": round(wait, 1) if self.state != "cerrado" else None}

    # ------------------------------------------------------------------ transitions
    def _set(self, state: str) -> None:
        if state != "semiabierto":
            self._probing = False  # a stale probe flag must never block the next half-open probe
        if state != self.state:
            previous, self.state = self.state, state
            log.warning("cambio de estado del circuito de la fuente",
                        extra={"evento": "circuito", "fuente": self.source, "estado": state, "anterior": previous})
            if self.on_change:
                self.on_change(self)

    def _tick(self) -> None:
        if self.state == "abierto" and self.retry_after() <= 0:
            self._set("semiabierto")

    def acquire(self) -> bool:
        """Permission to generate from the source. Returns True when this caller is the half-open probe.

        Raises CircuitOpen while open (or while another caller holds the half-open probe).
        """
        self._tick()
        if self.state == "cerrado":
            return False
        if self.state == "semiabierto" and not self._probing:
            self._probing = True
            return True
        raise CircuitOpen(self.source, max(self.retry_after(), 1.0))

    def release(self, probe: bool) -> None:
        """The generation ended without a verdict on the source (e.g. cancelled): free the probe slot."""
        if probe:
            self._probing = False

    def record_success(self, probe: bool = False) -> None:
        self.last_success = time.monotonic()
        self.consecutive = 0
        if probe:
            self._probing = False
        self._set("cerrado")

    def record_failure(self, started: float, probe: bool = False) -> bool:
        """Register a failed generation that started at `started` (monotonic). Returns whether it counted."""
        if probe:
            self._probing = False
            if self.state != "abierto":
                self._open()
            return True
        if self.last_success >= started:
            return False
        self.consecutive += 1
        if self.state == "semiabierto" or (self.state == "cerrado" and self.consecutive >= self.threshold):
            self._open()  # half-open: any failure of the probe's requests reopens at once
        return True

    def _open(self) -> None:
        self.opened_at = time.monotonic()
        self.openings += 1
        self._set("abierto")
