"""Prometheus metrics (one registry per app instance so tests stay isolated)."""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, disable_created_metrics, generate_latest

disable_created_metrics()


class Metrics:
    def __init__(self) -> None:
        r = self.registry = CollectorRegistry()
        self.requests = Counter("tiles_requests", "Peticiones de tiles por resultado de caché", ["cache", "layer"], registry=r)
        self.fetches = Counter("tiles_upstream_fetches", "Tiles generados consultando la fuente", ["layer", "source"], registry=r)
        self.upstream_requests = Counter("tiles_upstream_requests", "Peticiones HTTP/COG a la fuente", ["source", "status"], registry=r)
        self.upstream_errors = Counter("tiles_upstream_errors", "Errores de la fuente (incluye reintentos)", ["source"], registry=r)
        self.upstream_bytes = Counter("tiles_upstream_bytes", "Bytes recibidos de la fuente", ["source"], registry=r)
        self.egress = Counter("tiles_egress_bytes", "Bytes de tiles servidos a clientes", ["layer"], registry=r)
        self.storage_written = Counter("tiles_storage_written_bytes", "Bytes escritos en el almacenamiento", ["layer"], registry=r)
        self.storage_bytes = Gauge("tiles_storage_bytes", "Bytes almacenados (estimación: escaneo inicial + escrituras - purgas)", registry=r)
        self.storage_errors = Counter("tiles_storage_errors", "Errores del almacenamiento", ["op"], registry=r)
        self.miss_latency = Histogram("tiles_miss_latency_seconds", "Latencia de generación en fallo de caché", ["layer"],
                                      buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32), registry=r)
        self.hit_ratio = Gauge("tiles_cache_hit_ratio", "Tasa de acierto (HIT+STALE)/(HIT+STALE+MISS) desde el arranque", registry=r)
        self.budget_used = Gauge("tiles_upstream_budget_used", "Consumo diario de la fuente", ["source", "kind"], registry=r)
        self.budget_exceeded = Gauge("tiles_budget_exceeded", "1 si se superó el presupuesto diario", ["source", "kind"], registry=r)
        self.rejected = Counter("tiles_client_rejected", "Peticiones rechazadas", ["reason"], registry=r)
        self.circuit_state = Gauge("tiles_circuit_state", "Circuito por fuente: 0 cerrado, 1 semiabierto, 2 abierto", ["source"], registry=r)
        self.circuit_opened = Counter("tiles_circuit_opened", "Aperturas del circuito por fuente", ["source"], registry=r)
        self.fast_failures = Counter("tiles_fast_failures", "503 inmediatos sin consultar la fuente", ["source", "reason"], registry=r)
        self.generation_timeouts = Counter("tiles_generation_timeouts", "Generaciones cortadas por el plazo total", ["source"], registry=r)
        self._hits = 0
        self._served = 0

    def record_request(self, layer: str, cache: str) -> None:
        self.requests.labels(cache=cache, layer=layer).inc()
        if cache in ("HIT", "STALE", "MISS"):
            self._served += 1
            if cache != "MISS":
                self._hits += 1
            self.hit_ratio.set(self._hits / self._served)

    def render(self) -> bytes:
        return generate_latest(self.registry)

    def value(self, name: str, **labels: str) -> float | None:
        return self.registry.get_sample_value(name, labels)

    def total(self, name: str) -> float:
        return sum(s.value for m in self.registry.collect() for s in m.samples if s.name == name)
