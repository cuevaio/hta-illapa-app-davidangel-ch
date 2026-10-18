"""FastAPI application: /tiles, /capas, /salud, /metrics and the diagnostics page."""

from __future__ import annotations

import asyncio
import contextlib
import math
from typing import Annotated

from fastapi import FastAPI, Path, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .adapters.base import UpstreamAdapter
from .adapters.copernicus import CopernicusGlo30Adapter
from .adapters.roads import RoadsAdapter
from .adapters.terrain_tiles import TerrainTilesAdapter
from .adapters.worldcover import WorldCoverAdapter
from .config import Settings, load_settings, secret_values
from .logs import log, setup_logging
from .metrics import Metrics
from .models import Capas, Error, Salud
from .service import FORMAT, TileError, TileService, make_breakers
from .storage import Storage, StorageError, make_storage
from .upstream import TokenBucket, UpstreamClient

TILE_HEADERS = ["X-Tile-Min", "X-Tile-Max", "X-Tile-Source", "X-Tile-Version", "X-Tile-Date", "X-Tile-Overzoom", "X-Cache"]
ADAPTERS = {"terrain_tiles": TerrainTilesAdapter, "copernicus_glo30": CopernicusGlo30Adapter,
            "worldcover": WorldCoverAdapter, "roads": RoadsAdapter}
HTTP_MESSAGES = {400: "Petición inválida", 404: "Recurso no encontrado", 405: "Método no permitido",
                 429: "Demasiadas peticiones", 500: "Error interno del servidor", 503: "Servicio no disponible"}
DIAG_FILES = {"": ("diagnostico-backend.html", "text/html; charset=utf-8"),
              "diagnostico-backend.js": ("diagnostico-backend.js", "text/javascript; charset=utf-8")}

LayerP = Annotated[str, Path(pattern=r"^[a-z0-9][a-z0-9-]{0,39}$", description="Identificador de capa, p. ej. terreno")]
VersionP = Annotated[str, Path(pattern=r"^v[0-9]{1,4}$", description="Versión del tileset, p. ej. v1")]
ZP = Annotated[str, Path(pattern=r"^(0|[1-9][0-9]?)$", description="Nivel de zoom (entero)")]
XP = Annotated[str, Path(pattern=r"^(0|[1-9][0-9]{0,6})$", description="Columna XYZ (0 <= x < 2^z)")]
YP = Annotated[str, Path(pattern=r"^(0|[1-9][0-9]{0,6})(\.png)?$", description="Fila XYZ (0 <= y < 2^z, y hacia el sur), sufijo .png opcional")]

ERR = {"model": Error}


def build_adapters(settings: Settings, metrics: Metrics, breakers: dict | None = None) -> dict[str, UpstreamAdapter]:
    adapters: dict[str, UpstreamAdapter] = {}
    breakers = breakers or {}
    for sid, cfg in settings.sources.items():
        cls = ADAPTERS.get(cfg.tipo)
        if cls is None:
            raise ValueError(f"tipo de fuente desconocido: {cfg.tipo}")
        adapters[sid] = cls(cfg, UpstreamClient(cfg, contact=settings.contact, metrics=metrics, breaker=breakers.get(sid)))
    return adapters


def error(status: int, message: str, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status, headers=headers)


def catalog(settings: Settings, service: TileService) -> dict:
    capas = []
    for lay in settings.layers.values():
        versiones = []
        for tv in lay.versiones.values():
            src = settings.sources[tv.fuente]
            limit = [f"Resolución nativa ~{src.resolucion_nativa_m:g} m" if src.resolucion_nativa_m else "Resolución nativa sin verificar",
                     f"Nivel máximo real z{tv.zoom_max_real} (512 px); z{tv.zoom_max_real + 1}–z{tv.zoom_max} es sobremuestreo marcado"]
            if src.modelo_superficie:
                limit.append("Modelo digital de superficie (DSM): incluye vegetación y edificios")
            versiones.append({
                "version": tv.version, "url": f"/tiles/{lay.id}/{tv.version}/{{z}}/{{x}}/{{y}}.png",
                "zoom_min": tv.zoom_min, "zoom_max": tv.zoom_max, "zoom_max_real": tv.zoom_max_real,
                "transformacion": tv.transformacion, "descripcion": tv.descripcion, "formato": FORMAT,
                "fuente": {"id": src.id, "nombre": src.nombre, "atribucion": src.atribucion, "licencia": src.licencia,
                           "licencia_url": src.licencia_url, "resolucion_nativa_m": src.resolucion_nativa_m,
                           "modelo_superficie": src.modelo_superficie, "fecha_datos": src.fecha_datos,
                           "precarga_permitida": src.precarga_permitida},
                "limitaciones": limit, "huella": tv.fingerprint(src),
            })
        capas.append({"id": lay.id, "nombre": lay.nombre, "tipo": lay.tipo, "version_actual": lay.version_actual, "versiones": versiones})
    w, s, e, n = settings.bbox
    return {"bbox": {"oeste": w, "sur": s, "este": e, "norte": n}, "cabeceras_tile": TILE_HEADERS, "capas": capas}


def _fmt(v: float | None) -> str:
    return "nodata" if v is None else f"{v:.2f}"


def create_app(settings: Settings | None = None, *, storage: Storage | None = None,
               adapters: dict[str, UpstreamAdapter] | None = None) -> FastAPI:
    settings = settings or load_settings()
    setup_logging(settings.log_level, secret_values(settings))
    metrics = Metrics()
    storage = storage or make_storage(settings)
    breakers = make_breakers(settings)
    adapters = adapters if adapters is not None else build_adapters(settings, metrics, breakers)
    service = TileService(settings, storage, adapters, metrics, breakers)

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        log.info("arranque", extra={"evento": "arranque", "config": settings.public_summary()})
        await service.check_all_manifests()
        scan = asyncio.create_task(service.scan_storage())
        yield
        scan.cancel()
        await service.aclose()

    app = FastAPI(
        title="API de tiles del simulador",
        version=__version__,
        description=("Caché de lectura de tiles (terreno de Perú). Tiles PNG 512x512 Terrarium "
                     "(h = R*256 + G + B/256 - 32768 m; nodata RGB 0,0,0). Rutas versionadas e inmutables."),
        lifespan=lifespan,
        docs_url=None, redoc_url=None,
    )
    app.state.service = service
    app.state.settings = settings

    buckets: dict[str, TokenBucket] = {}

    @app.middleware("http")
    async def rate_limit(request: Request, call_next):
        if request.url.path in ("/salud", "/metrics"):
            return await call_next(request)
        client = request.client.host if request.client else "desconocido"
        if settings.trust_forwarded_for and (fwd := request.headers.get("x-forwarded-for")):
            client = fwd.split(",")[0].strip()[:64]
        bucket = buckets.get(client)
        if bucket is None:
            if len(buckets) > 50_000:
                buckets.clear()
            bucket = buckets[client] = TokenBucket(settings.client_rate, settings.client_burst)
        wait = bucket.try_acquire()
        if wait > 0:
            metrics.rejected.labels(reason="tasa_cliente").inc()
            retry = str(max(1, math.ceil(wait)))
            return error(429, f"Demasiadas peticiones; vuelve a intentarlo en {retry} s", {"Retry-After": retry})
        return await call_next(request)

    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET"], allow_headers=[],
                       expose_headers=TILE_HEADERS + ["Retry-After"], allow_credentials=False, max_age=600)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        return error(exc.status_code, HTTP_MESSAGES.get(exc.status_code, "Error"))

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        metrics.rejected.labels(reason="parametros").inc()
        return error(400, "Parámetros de ruta inválidos: capa, versión, z, x e y deben tener el formato documentado")

    @app.exception_handler(TileError)
    async def tile_error(request: Request, exc: TileError):
        if exc.status in (400, 404):
            metrics.rejected.labels(reason=str(exc.status)).inc()
        return error(exc.status, exc.message, exc.headers)

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception):
        log.error("error no controlado", exc_info=exc, extra={"evento": "error"})
        return error(500, HTTP_MESSAGES[500])

    @app.get("/tiles/{layer}/{version}/{z}/{x}/{y}", tags=["tiles"], summary="Tile XYZ (PNG 512 px Terrarium)",
             response_class=Response,
             responses={200: {"content": {"image/png": {}}, "description": "Tile de alturas",
                              "headers": {h: {"schema": {"type": "string"}} for h in TILE_HEADERS + ["Cache-Control"]}},
                        400: ERR, 404: ERR, 429: ERR, 501: ERR, 502: ERR, 503: ERR})
    async def get_tile(layer: LayerP, version: VersionP, z: ZP, x: XP, y: YP) -> Response:
        zi, xi, yi = int(z), int(x), int(y.removesuffix(".png"))
        result = await service.get_tile(layer, version, zi, xi, yi)
        m = result.meta
        metrics.egress.labels(layer=layer).inc(len(result.png))
        headers = {
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Tile-Min": _fmt(m.get("min")), "X-Tile-Max": _fmt(m.get("max")),
            "X-Tile-Source": str(m.get("fuente")), "X-Tile-Version": str(m.get("version")),
            "X-Tile-Date": str(m.get("fecha")), "X-Tile-Overzoom": "1" if m.get("sobremuestreo") else "0",
            "X-Cache": result.cache, "ETag": f'"{m.get("sha256", "")[:32]}"',
        }
        return Response(content=result.png, media_type="image/png", headers=headers)

    @app.get("/capas", response_model=Capas, tags=["catálogo"], summary="Catálogo de capas y versiones", responses={429: ERR})
    async def get_capas() -> dict:
        return catalog(settings, service)

    @app.get("/salud", response_model=Salud, tags=["operación"], summary="Estado del servicio")
    async def get_salud() -> dict:
        try:
            await asyncio.wait_for(asyncio.to_thread(storage.check), timeout=5)
            storage_ok = True
        except (StorageError, asyncio.TimeoutError):
            storage_ok = False
        capas = {lay.id: {v: ("conflicto" if (lay.id, v) in service.conflicts else "ok") for v in lay.versiones}
                 for lay in settings.layers.values()}
        fuentes = service.circuits()
        circuits_closed = all(f["circuito"] == "cerrado" for f in fuentes.values())
        estado = "ok" if storage_ok and not service.conflicts and circuits_closed else "degradado"
        return {"estado": estado, "version": __version__, "almacenamiento": storage.kind,
                "almacenamiento_ok": storage_ok, "capas": capas, "fuentes": fuentes}

    @app.get("/metrics", response_class=PlainTextResponse, tags=["operación"], summary="Métricas Prometheus",
             responses={200: {"content": {"text/plain": {}}}, 404: ERR})
    async def get_metrics() -> Response:
        if not settings.metrics_enabled:
            return error(404, HTTP_MESSAGES[404])
        service.circuits()  # refresh lazy open -> half-open transitions before rendering the gauge
        return Response(metrics.render(), media_type="text/plain; version=0.0.4; charset=utf-8")

    @app.get("/diagnostico", include_in_schema=False)
    async def diag_redirect() -> Response:
        # relative redirect keeps working behind a path prefix (e.g. the Vite proxy /tiles-api)
        return RedirectResponse("diagnostico/", status_code=308)

    @app.get("/diagnostico/", include_in_schema=False)
    async def diag_page() -> Response:
        return _diag("")

    @app.get("/diagnostico/{name}", include_in_schema=False)
    async def diag_asset(name: str) -> Response:
        return _diag(name)

    def _diag(name: str) -> Response:
        entry = DIAG_FILES.get(name)
        path = settings.diagnostico_dir / entry[0] if entry else None
        if path is None or not path.is_file():
            return error(404, HTTP_MESSAGES[404])
        return FileResponse(path, media_type=entry[1], headers={"Cache-Control": "no-cache"})

    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {"servicio": "tiles", "version": __version__, "capas": "/capas", "salud": "/salud", "diagnostico": "/diagnostico"}

    return app
