"""Command line: serve, purge/regenerate by layer or version, prewarm coarse levels, export schemas."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

from .config import Settings, load_settings
from .logs import log
from .service import TileError, TileService
from .storage import Storage, make_storage
from .tilemath import tiles_in_bbox

MANIFEST = "_tileset.json"


def _check_layer(settings: Settings, layer: str, version: str | None) -> None:
    if layer not in settings.layers:
        raise SystemExit(f"capa desconocida: {layer}")
    if version is not None and version not in settings.layers[layer].versiones:
        raise SystemExit(f"versión desconocida para {layer}: {version}")


def purge(settings: Settings, storage: Storage, layer: str, version: str | None, include_manifest: bool = False) -> int:
    """Delete the tiles of one layer (or one version of it); other layers/versions are untouched.

    The version manifest (fingerprint) is kept unless include_manifest, so a purged version can only be
    regenerated with the same source and transformation.
    """
    _check_layer(settings, layer, version)
    prefix = f"{layer}/{version}/" if version else f"{layer}/"
    keys = [k for k, _ in storage.list_prefix(prefix) if include_manifest or not k.endswith("/" + MANIFEST)]
    for i in range(0, len(keys), 1000):
        storage.delete(keys[i:i + 1000])
    log.info("purga", extra={"evento": "purga", "capa": layer, "version": version, "objetos": len(keys)})
    return len(keys)


async def prewarm(service: TileService, layer: str, version: str, zmin: int, zmax: int, concurrency: int = 8) -> dict:
    settings = service.settings
    _check_layer(settings, layer, version)
    tv = settings.layers[layer].versiones[version]
    source = settings.sources[tv.fuente]
    if not source.precarga_permitida:
        raise SystemExit(f"la fuente {source.id} no permite precarga: {source.motivo_precarga or 'política de la fuente'}")
    zmin, zmax = max(zmin, tv.zoom_min), min(zmax, tv.zoom_max)
    work = [(z, x, y) for z in range(zmin, zmax + 1) for x, y in tiles_in_bbox(z, settings.bbox)]
    report = {"capa": layer, "version": version, "zmin": zmin, "zmax": zmax, "tiles": len(work), "generated": 0,
              "cached": 0, "failed": 0, "bytes": 0, "por_zoom": {}}
    upstream_before = service.metrics.total("tiles_upstream_bytes_total")
    requests_before = service.metrics.total("tiles_upstream_requests_total")
    sem = asyncio.Semaphore(max(concurrency, 1))
    t0 = time.perf_counter()

    async def one(z: int, x: int, y: int) -> None:
        async with sem:
            try:
                result = await service.get_tile(layer, version, z, x, y)
            except TileError as exc:
                report["failed"] += 1
                log.warning("precarga: tile fallido", extra={"evento": "precarga", "z": z, "x": x, "y": y, "detalle": exc.message})
                return
        report["generated" if result.cache == "MISS" else "cached"] += 1
        report["bytes"] += len(result.png)
        pz = report["por_zoom"].setdefault(str(z), {"tiles": 0, "bytes": 0})
        pz["tiles"] += 1
        pz["bytes"] += len(result.png)

    await asyncio.gather(*(one(*t) for t in work))
    report["seconds"] = round(time.perf_counter() - t0, 2)
    report["upstream_bytes"] = int(service.metrics.total("tiles_upstream_bytes_total") - upstream_before)
    report["upstream_requests"] = int(service.metrics.total("tiles_upstream_requests_total") - requests_before)
    return report


def export_schemas(out_dir: Path) -> None:
    from .app import create_app
    from .models import Capas, TileMetadata

    import tempfile

    from .storage import FileStorage

    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:  # the OpenAPI document does not depend on storage
        app = create_app(load_settings(), storage=FileStorage(tmp), adapters={})
        openapi = app.openapi()
    (out_dir / "openapi.json").write_text(json.dumps(openapi, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for name, model in (("tile-metadata.schema.json", TileMetadata), ("capas.schema.json", Capas)):
        schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", **model.model_json_schema()}
        (out_dir / name).write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="tiles", description="Backend de tiles con caché de lectura")
    sub = parser.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="arranca la API")
    s.add_argument("--host", default="0.0.0.0")
    s.add_argument("--port", type=int, default=8080)
    p = sub.add_parser("purgar", help="borra los tiles de una capa o de una versión")
    p.add_argument("--capa", required=True)
    p.add_argument("--version")
    p.add_argument("--incluir-manifiesto", action="store_true", help="borra también la huella de la versión")
    for name, help_ in (("precalentar", "genera los niveles gruesos sobre la caja de Perú"),
                        ("regenerar", "purga una versión y vuelve a precalentarla")):
        w = sub.add_parser(name, help=help_)
        w.add_argument("--capa", required=True)
        w.add_argument("--version", required=True)
        w.add_argument("--zmin", type=int, default=0)
        w.add_argument("--zmax", type=int, default=9)
        w.add_argument("--concurrencia", type=int, default=8)
        w.add_argument("--informe", type=Path, help="escribe el informe JSON en este fichero")
    e = sub.add_parser("esquemas", help="exporta OpenAPI y JSON Schema al paquete compartido")
    e.add_argument("--out-dir", type=Path, default=Path("packages/tiles-schema"))
    args = parser.parse_args(argv)

    if args.cmd == "serve":
        import uvicorn

        uvicorn.run("tiles_service.app:create_app", factory=True, host=args.host, port=args.port,
                    access_log=False, log_level="warning", proxy_headers=False)
        return
    if args.cmd == "esquemas":
        export_schemas(args.out_dir)
        return

    settings = load_settings()
    from .app import create_app

    app = create_app(settings)
    service: TileService = app.state.service
    storage = service.storage
    if args.cmd == "purgar":
        n = purge(settings, storage, args.capa, args.version, args.incluir_manifiesto)
        print(json.dumps({"purgados": n}))
        return

    async def run() -> dict:
        try:
            if args.cmd == "regenerar":
                purge(settings, storage, args.capa, args.version)
            return await prewarm(service, args.capa, args.version, args.zmin, args.zmax, args.concurrencia)
        finally:
            await service.aclose()

    report = asyncio.run(run())
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.informe:
        args.informe.write_text(text + "\n", encoding="utf-8")
    print(text)
    sys.exit(1 if report["failed"] else 0)


if __name__ == "__main__":
    main()
