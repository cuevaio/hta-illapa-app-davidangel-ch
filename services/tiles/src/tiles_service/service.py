"""Read-through tile cache: validation, single-flight generation, stale-if-error, negative caches, circuit breaker."""

from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import json
import math
import time
from dataclasses import dataclass
from typing import Any

from .adapters.base import AdapterTile, SourceUnavailable, TileNotFound, UpstreamAdapter
from .breaker import STATE_CODE, CircuitBreaker, CircuitOpen
from .config import Settings, TilesetVersion
from .logs import log
from .metrics import Metrics
from .storage import Storage, StorageError, tile_key
from .terrarium import encode_png, height_stats
from .tilemath import intersects, tile_bounds_lonlat

UNAVAILABLE = "La fuente no está disponible y el tile no está en caché"

FORMAT = {"codificacion": "terrarium", "formula": "h = R*256 + G + B/256 - 32768", "unidad": "m",
          "tamano_px": 512, "mime": "image/png", "nodata_rgb": [0, 0, 0], "nodata_umbral_m": -32767}


class TileError(Exception):
    def __init__(self, status: int, message: str, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status = status
        self.message = message
        self.headers = headers or {}


@dataclass
class TileResult:
    png: bytes
    meta: dict[str, Any]
    cache: str  # HIT | MISS | STALE


def now_iso() -> str:
    return dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(value: str) -> float:
    return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.UTC).timestamp()


class TileService:
    def __init__(self, settings: Settings, storage: Storage, adapters: dict[str, UpstreamAdapter], metrics: Metrics | None = None,
                 breakers: dict[str, CircuitBreaker] | None = None):
        self.settings = settings
        self.storage = storage
        self.adapters = adapters
        self.metrics = metrics or Metrics()
        self.breakers = breakers if breakers is not None else make_breakers(settings)
        for breaker in self.breakers.values():
            breaker.on_change = self._circuit_changed
            self.metrics.circuit_state.labels(source=breaker.source).set(STATE_CODE[breaker.state])
        self._inflight: dict[str, asyncio.Task] = {}
        self._negative: dict[str, float] = {}
        self._outage: dict[str, tuple[float, str]] = {}  # tile key -> (expiry, source): recent outage failures
        self._manifest_ok: set[tuple[str, str]] = set()
        self.conflicts: dict[tuple[str, str], str] = {}
        self._stored_bytes = 0.0

    # ------------------------------------------------------------------ validation
    def validate(self, layer: str, version: str, z: int, x: int, y: int) -> TilesetVersion:
        lay = self.settings.layers.get(layer)
        if lay is None:
            raise TileError(404, f"Capa desconocida: {layer}")
        tv = lay.versiones.get(version)
        if tv is None:
            raise TileError(404, f"Versión desconocida para la capa {layer}: {version}")
        if not (0 <= x < 2**z and 0 <= y < 2**z):
            raise TileError(400, "Coordenadas de tile fuera de rango para el nivel de zoom")
        if not (tv.zoom_min <= z <= tv.zoom_max):
            raise TileError(404, f"Nivel de zoom fuera de los permitidos para {layer}/{version} (z{tv.zoom_min}–z{tv.zoom_max})")
        if not intersects(tile_bounds_lonlat(z, x, y), self.settings.bbox):
            raise TileError(404, "El tile está fuera de la zona permitida (Perú)")
        return tv

    # ------------------------------------------------------------------ manifests
    async def ensure_manifest(self, tv: TilesetVersion) -> None:
        ident = (tv.layer, tv.version)
        if ident in self._manifest_ok:
            return
        if ident in self.conflicts:
            raise TileError(503, self.conflicts[ident])
        source = self.settings.sources[tv.fuente]
        fp = tv.fingerprint(source)
        key = f"{tv.layer}/{tv.version}/_tileset.json"
        raw = await asyncio.to_thread(self.storage.get, key)
        if raw is None:
            manifest = {"capa": tv.layer, "version": tv.version, "fuente": source.id, "tipo_fuente": source.tipo,
                        "transformacion": tv.transformacion, "zoom_max_real": tv.zoom_max_real, "huella": fp, "creado": now_iso()}
            await asyncio.to_thread(self.storage.put, key, json.dumps(manifest, ensure_ascii=False).encode(), "application/json")
        elif json.loads(raw).get("huella") != fp:
            msg = (f"La versión {tv.version} de {tv.layer} ya existe con otra fuente o transformación; "
                   "declara una versión nueva en la configuración del tileset")
            self.conflicts[ident] = msg
            log.error("conflicto de versión de tileset", extra={"evento": "version_conflicto", "capa": tv.layer, "version": tv.version})
            raise TileError(503, msg)
        self._manifest_ok.add(ident)

    async def check_all_manifests(self) -> None:
        for lay in self.settings.layers.values():
            for tv in lay.versiones.values():
                try:
                    await self.ensure_manifest(tv)
                except TileError:
                    pass
                except StorageError as exc:
                    log.warning("no se pudo verificar el manifiesto", extra={"evento": "manifiesto", "capa": tv.layer,
                                                                             "version": tv.version, "detalle": str(exc)})

    async def scan_storage(self) -> None:
        try:
            total = await asyncio.to_thread(lambda: sum(n for _, n in self.storage.list_prefix("")))
        except StorageError:
            return
        self._stored_bytes += total
        self.metrics.storage_bytes.set(self._stored_bytes)

    # ------------------------------------------------------------------ storage helpers
    async def _load(self, key_png: str, key_meta: str) -> tuple[bytes, dict] | None:
        try:
            raw_meta = await asyncio.to_thread(self.storage.get, key_meta)
            if raw_meta is None:
                return None  # metadata is written last: no metadata = incomplete tile
            png = await asyncio.to_thread(self.storage.get, key_png)
        except StorageError as exc:
            self.metrics.storage_errors.labels(op="get").inc()
            log.warning("error leyendo del almacenamiento", extra={"evento": "almacenamiento_error", "detalle": str(exc)})
            return None
        if png is None:
            return None
        return png, json.loads(raw_meta)

    async def _store(self, tv: TilesetVersion, key_png: str, key_meta: str, png: bytes, meta: dict) -> None:
        try:
            await asyncio.to_thread(self.storage.put, key_png, png, "image/png")
            body = json.dumps(meta, ensure_ascii=False).encode()
            await asyncio.to_thread(self.storage.put, key_meta, body, "application/json")
        except StorageError as exc:
            self.metrics.storage_errors.labels(op="put").inc()
            log.warning("error guardando en el almacenamiento", extra={"evento": "almacenamiento_error", "detalle": str(exc)})
            return
        self.metrics.storage_written.labels(layer=tv.layer).inc(len(png) + len(body))
        self._stored_bytes += len(png) + len(body)
        self.metrics.storage_bytes.set(self._stored_bytes)

    # ------------------------------------------------------------------ circuit breaker
    def _circuit_changed(self, breaker: CircuitBreaker) -> None:
        self.metrics.circuit_state.labels(source=breaker.source).set(STATE_CODE[breaker.state])
        if breaker.state == "abierto":
            self.metrics.circuit_opened.labels(source=breaker.source).inc()
        elif breaker.state == "cerrado":  # source is back: forget its recent outage failures
            self._outage = {k: v for k, v in self._outage.items() if v[1] != breaker.source}

    def circuits(self) -> dict[str, dict]:
        return {sid: b.snapshot() for sid, b in self.breakers.items()}

    def _fast_fail(self, layer: str, source: str, reason: str, retry_after: float) -> TileError:
        self.metrics.fast_failures.labels(source=source, reason=reason).inc()
        self.metrics.record_request(layer, "ERROR")
        return TileError(503, UNAVAILABLE, {"Retry-After": str(max(1, math.ceil(retry_after)))})

    # ------------------------------------------------------------------ generation
    async def _generate(self, tv: TilesetVersion, z: int, x: int, y: int) -> tuple[bytes, dict]:
        source = self.settings.sources[tv.fuente]
        adapter = self.adapters.get(source.id)
        if adapter is None:
            raise TileError(503, "La fuente de esta capa no está configurada")
        breaker = self.breakers.get(source.id)
        probe = breaker.acquire() if breaker else False  # raises CircuitOpen while the source is considered down
        started = time.monotonic()
        t0 = time.perf_counter()
        self.metrics.fetches.labels(layer=tv.layer, source=source.id).inc()
        verdict = False
        try:
            deadline = source.plazo_generacion_s if source.plazo_generacion_s is not None else self.settings.generation_deadline_s
            tile: AdapterTile = await asyncio.wait_for(adapter.fetch(z, x, y, tv.zoom_max_real),
                                                       deadline if deadline > 0 else None)
            verdict = True
            if breaker:
                breaker.record_success(probe)
        except TimeoutError:
            self.metrics.generation_timeouts.labels(source=source.id).inc()
            verdict = True
            counted = breaker.record_failure(started, probe) if breaker else True
            log.warning("plazo de generación agotado", extra={"evento": "plazo", "fuente": source.id, "capa": tv.layer,
                                                              "z": z, "x": x, "y": y, "plazo_s": deadline})
            exc = SourceUnavailable("plazo de generación agotado")
            exc.outage = counted
            raise exc from None
        except SourceUnavailable as exc:
            verdict = True
            exc.outage = breaker.record_failure(started, probe) if breaker else True
            raise
        except TileNotFound:
            verdict = True
            if breaker:
                breaker.record_success(probe)  # the source answered
            raise
        except NotImplementedError:
            raise TileError(501, "Esta capa aún no está implementada") from None
        finally:
            if breaker and not verdict:
                breaker.release(probe)
        png = await asyncio.to_thread(encode_png, tile.rgb)
        lo, hi = await asyncio.to_thread(height_stats, tile.rgb)
        meta = {
            "capa": tv.layer, "version": tv.version, "z": z, "x": x, "y": y,
            "min": None if lo is None else round(lo, 2), "max": None if hi is None else round(hi, 2),
            "fuente": source.id, "fecha": now_iso(), "fecha_datos": source.fecha_datos,
            "sobremuestreo": bool(z > tv.zoom_max_real or tile.overzoom), "modelo_superficie": source.modelo_superficie,
            "formato": "terrarium-png-512", "huella": tv.fingerprint(source),
            "sha256": hashlib.sha256(png).hexdigest(), "bytes": len(png),
            "origen": {k: v for k, v in tile.upstream.items() if isinstance(v, (str, int, float, list))},
        }
        self.metrics.miss_latency.labels(layer=tv.layer).observe(time.perf_counter() - t0)
        return png, meta

    def _run_once(self, key: str, factory) -> asyncio.Task:
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.ensure_future(factory())
            self._inflight[key] = task

            def done(t: asyncio.Task, key=key) -> None:
                self._inflight.pop(key, None)
                if not t.cancelled():
                    t.exception()  # mark retrieved

            task.add_done_callback(done)
        return task

    async def _miss(self, tv: TilesetVersion, z: int, x: int, y: int, key_png: str, key_meta: str) -> tuple[bytes, dict]:
        try:
            png, meta = await self._generate(tv, z, x, y)
        except SourceUnavailable as exc:
            ttl = self.settings.outage_ttl_s
            if ttl > 0 and exc.outage:  # only outages, not congestion of a live source
                self._outage[key_png] = (time.monotonic() + ttl, tv.fuente)
                if len(self._outage) > 100_000:
                    now = time.monotonic()
                    self._outage = {k: v for k, v in self._outage.items() if v[0] > now}
            raise
        except TileNotFound:
            self._negative[key_png] = time.monotonic() + self.settings.negative_ttl_s
            if len(self._negative) > 100_000:
                now = time.monotonic()
                self._negative = {k: v for k, v in self._negative.items() if v > now}
            raise
        await self._store(tv, key_png, key_meta, png, meta)
        log.info("tile generado", extra={"evento": "miss", "capa": tv.layer, "version": tv.version, "z": z, "x": x, "y": y,
                                         "bytes": len(png), "sobremuestreo": meta["sobremuestreo"]})
        return png, meta

    async def _revalidate(self, tv, z, x, y, key_meta, png: bytes, meta: dict) -> str:
        try:
            fresh, fresh_meta = await self._run_once("reval:" + key_meta, lambda: self._generate(tv, z, x, y))
        except (SourceUnavailable, TileNotFound, TileError, CircuitOpen) as exc:
            log.info("fuente caída al revalidar; se sirve copia guardada", extra={"evento": "stale", "capa": tv.layer, "detalle": str(exc)})
            return "STALE"
        if fresh_meta["sha256"] != meta.get("sha256"):
            log.warning("la fuente cambió sus datos; los bytes guardados se conservan (crea una versión nueva)",
                        extra={"evento": "fuente_cambio", "capa": tv.layer, "version": tv.version, "z": z, "x": x, "y": y})
        meta["revisado"] = fresh_meta["fecha"]
        try:
            await asyncio.to_thread(self.storage.put, key_meta, json.dumps(meta, ensure_ascii=False).encode(), "application/json")
        except StorageError:
            pass
        return "HIT"

    async def get_tile(self, layer: str, version: str, z: int, x: int, y: int) -> TileResult:
        tv = self.validate(layer, version, z, x, y)
        await self.ensure_manifest_safe(tv)
        key_png = tile_key(layer, version, z, x, y, "png")
        key_meta = tile_key(layer, version, z, x, y, "json")
        stored = await self._load(key_png, key_meta)
        if stored is not None:
            png, meta = stored
            cache = "HIT"
            if tv.revalidar_tras_s is not None:
                checked = meta.get("revisado") or meta.get("fecha")
                if checked and time.time() - _parse_iso(checked) >= tv.revalidar_tras_s:
                    cache = await self._revalidate(tv, z, x, y, key_meta, png, meta)
            self.metrics.record_request(layer, cache)
            return TileResult(png, meta, cache)
        expiry = self._negative.get(key_png)
        if expiry and expiry > time.monotonic():
            self.metrics.record_request(layer, "NEGATIVE")
            raise TileError(404, "El tile no existe en la fuente")
        outage = self._outage.get(key_png)
        if outage and outage[0] > time.monotonic() and key_png not in self._inflight:
            raise self._fast_fail(layer, tv.fuente, "caida_reciente", outage[0] - time.monotonic())
        try:
            png, meta = await asyncio.shield(self._run_once(key_png, lambda: self._miss(tv, z, x, y, key_png, key_meta)))
        except TileNotFound:
            self.metrics.record_request(layer, "NEGATIVE")
            raise TileError(404, "El tile no existe en la fuente") from None
        except CircuitOpen as exc:
            raise self._fast_fail(layer, tv.fuente, "circuito", exc.retry_after) from None
        except SourceUnavailable:
            self.metrics.record_request(layer, "ERROR")
            raise TileError(503, UNAVAILABLE, {"Retry-After": str(max(1, math.ceil(self.settings.outage_ttl_s)))}) from None
        except TileError:
            self.metrics.record_request(layer, "ERROR")
            raise
        except Exception:
            self.metrics.record_request(layer, "ERROR")
            log.exception("error inesperado generando el tile", extra={"evento": "error", "capa": layer, "z": z, "x": x, "y": y})
            raise TileError(502, "Error al generar el tile") from None
        self.metrics.record_request(layer, "MISS")
        return TileResult(png, meta, "MISS")

    async def ensure_manifest_safe(self, tv: TilesetVersion) -> None:
        try:
            await self.ensure_manifest(tv)
        except StorageError as exc:
            log.warning("no se pudo verificar el manifiesto", extra={"evento": "manifiesto", "detalle": str(exc)})

    async def aclose(self) -> None:
        for adapter in self.adapters.values():
            await adapter.aclose()


def make_breakers(settings: Settings) -> dict[str, CircuitBreaker]:
    return {sid: CircuitBreaker(sid, settings.circuit_failures, settings.circuit_cooldown_s) for sid in settings.sources}
