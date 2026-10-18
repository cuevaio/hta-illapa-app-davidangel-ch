"""Settings: environment variables (secrets only here) + declarative tilesets file."""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
VERSION_RE = re.compile(r"^v[0-9]{1,4}$")
_ENV_RE = re.compile(r"\$\{([A-Z0-9_]+)(?::-([^}]*))?\}")

PACKAGE_DIR = Path(__file__).resolve().parent
_UP = PACKAGE_DIR.parents
DEFAULT_TILESETS = (_UP[1] if len(_UP) > 1 else PACKAGE_DIR) / "tilesets.yaml"  # services/tiles/tilesets.yaml
DEFAULT_DIAGNOSTICO = (_UP[1] if len(_UP) > 1 else PACKAGE_DIR) / "diagnostico"  # services/tiles/diagnostico
DEFAULT_CORS = "http://localhost:5173,https://localhost:5173,http://localhost:5199,https://localhost:5443,http://127.0.0.1:5173"
PERU_BBOX = (-81.5, -18.5, -68.5, 0.2)  # west, south, east, north (covers Natural Earth 10 m outline)


class ConfigError(ValueError):
    pass


class Secret:
    """Holds a secret value; never shows it in repr/str."""

    __slots__ = ("_value",)

    def __init__(self, value: str | None):
        self._value = value or None

    def get(self) -> str | None:
        return self._value

    def __bool__(self) -> bool:
        return self._value is not None

    def __repr__(self) -> str:
        return "Secret('***')" if self._value else "Secret(None)"

    __str__ = __repr__


@dataclass
class SourceConfig:
    id: str
    tipo: str
    nombre: str
    atribucion: str
    licencia: str
    licencia_url: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    resolucion_nativa_m: float | None = None
    modelo_superficie: bool = False
    fecha_datos: str | None = None
    precarga_permitida: bool = False
    motivo_precarga: str = ""
    tasa_por_s: float = 10.0
    rafaga: int = 20
    concurrencia: int = 8
    reintentos: int = 3
    espera_inicial_s: float = 0.5
    timeout_s: float = 20.0
    timeout_conexion_s: float = 3.0
    plazo_generacion_s: float | None = None  # per-source override of TILES_GENERATION_DEADLINE_S
    http2: bool = True
    presupuesto: dict[str, Any] = field(default_factory=dict)


@dataclass
class TilesetVersion:
    layer: str
    version: str
    fuente: str
    zoom_min: int
    zoom_max: int
    zoom_max_real: int
    transformacion: dict[str, Any] = field(default_factory=dict)
    revalidar_tras_s: float | None = None
    descripcion: str = ""

    def fingerprint(self, source: SourceConfig) -> str:
        """Identity of what produces the tiles; a change here requires a new version."""
        ident = {"fuente": source.id, "tipo": source.tipo, "transformacion": self.transformacion,
                 "zoom_max_real": self.zoom_max_real}
        return hashlib.sha256(json.dumps(ident, sort_keys=True).encode()).hexdigest()[:16]


@dataclass
class Layer:
    id: str
    nombre: str
    tipo: str
    versiones: dict[str, TilesetVersion]
    version_actual: str


@dataclass
class Settings:
    tilesets_path: Path
    sources: dict[str, SourceConfig]
    layers: dict[str, Layer]
    bbox: tuple[float, float, float, float] = PERU_BBOX
    zoom_max_global: int = 14
    cors_origins: list[str] = field(default_factory=list)
    contact: str = "configurable"
    storage: str = "fs"
    fs_root: Path = Path("data/tiles")
    s3_bucket: str = "tiles"
    s3_prefix: str = ""
    s3_endpoint: str | None = None
    s3_region: str = "us-east-1"
    s3_access_key: Secret = field(default_factory=lambda: Secret(None))
    s3_secret_key: Secret = field(default_factory=lambda: Secret(None))
    negative_ttl_s: float = 300.0
    outage_ttl_s: float = 15.0
    circuit_failures: int = 5
    circuit_cooldown_s: float = 30.0
    generation_deadline_s: float = 10.0
    client_rate: float = 100.0
    client_burst: int = 400
    trust_forwarded_for: bool = False
    log_level: str = "INFO"
    diagnostico_dir: Path = DEFAULT_DIAGNOSTICO
    metrics_enabled: bool = True

    def public_summary(self) -> dict[str, Any]:
        """Configuration safe to log (no secrets, no credentials)."""
        return {
            "tilesets": str(self.tilesets_path.name), "storage": self.storage, "s3_bucket": self.s3_bucket
            if self.storage == "s3" else None, "bbox": self.bbox, "cors_origins": self.cors_origins,
            "capas": {k: sorted(v.versiones) for k, v in self.layers.items()},
            "credenciales_s3": bool(self.s3_access_key and self.s3_secret_key),
        }

    def version(self, layer: str, version: str) -> TilesetVersion | None:
        lay = self.layers.get(layer)
        return lay.versiones.get(version) if lay else None


def _expand(value: Any, env: Mapping[str, str]) -> Any:
    if isinstance(value, str):
        out = _ENV_RE.sub(lambda m: env.get(m.group(1)) or (m.group(2) or ""), value)
        if out != value and _ENV_RE.fullmatch(value):
            return yaml.safe_load(out) if out else None  # typed scalar: "20" -> 20, "true" -> True
        return out
    if isinstance(value, dict):
        return {k: _expand(v, env) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand(v, env) for v in value]
    return value


_SOURCE_KEYS = {f for f in SourceConfig.__dataclass_fields__} - {"id", "params"}


def parse_tilesets(text: str, env: Mapping[str, str], zoom_max_global: int = 14) -> tuple[dict, dict]:
    raw = _expand(yaml.safe_load(text) or {}, env)
    sources: dict[str, SourceConfig] = {}
    for sid, spec in (raw.get("fuentes") or {}).items():
        if not ID_RE.match(sid):
            raise ConfigError(f"identificador de fuente inválido: {sid!r}")
        spec = dict(spec)
        params = spec.pop("parametros", {}) or {}
        unknown = set(spec) - _SOURCE_KEYS
        if unknown:
            raise ConfigError(f"claves desconocidas en la fuente {sid}: {sorted(unknown)}")
        sources[sid] = SourceConfig(id=sid, params=params, **spec)
    layers: dict[str, Layer] = {}
    for lid, spec in (raw.get("capas") or {}).items():
        if not ID_RE.match(lid):
            raise ConfigError(f"identificador de capa inválido: {lid!r}")
        versions: dict[str, TilesetVersion] = {}
        for ver, vspec in (spec.get("versiones") or {}).items():
            if not VERSION_RE.match(ver):
                raise ConfigError(f"versión inválida {lid}/{ver}")
            v = TilesetVersion(layer=lid, version=ver, **vspec)
            if v.fuente not in sources:
                raise ConfigError(f"{lid}/{ver} usa una fuente inexistente: {v.fuente}")
            if not (0 <= v.zoom_min <= v.zoom_max <= zoom_max_global) or not (0 <= v.zoom_max_real <= v.zoom_max):
                raise ConfigError(f"niveles de zoom inválidos en {lid}/{ver}")
            versions[ver] = v
        if not versions:
            raise ConfigError(f"la capa {lid} no tiene versiones")
        layers[lid] = Layer(id=lid, nombre=spec.get("nombre", lid), tipo=spec.get("tipo", "altura"),
                            versiones=versions, version_actual=spec.get("version_actual", list(versions)[-1]))
    return sources, layers


def _bool(value: str | None, default: bool) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "si", "sí", "on")


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    path = Path(env.get("TILES_TILESETS") or DEFAULT_TILESETS)
    zmax = int(env.get("TILES_ZOOM_MAX", "14"))
    sources, layers = parse_tilesets(path.read_text(encoding="utf-8"), env, zmax)
    bbox = PERU_BBOX
    if env.get("TILES_BBOX"):
        parts = tuple(float(p) for p in env["TILES_BBOX"].split(","))
        if len(parts) != 4:
            raise ConfigError("TILES_BBOX debe ser oeste,sur,este,norte")
        bbox = parts  # type: ignore[assignment]
    cors = env.get("TILES_CORS_ORIGINS", DEFAULT_CORS)
    return Settings(
        tilesets_path=path,
        sources=sources,
        layers=layers,
        bbox=bbox,
        zoom_max_global=zmax,
        cors_origins=[o.strip() for o in cors.split(",") if o.strip()],
        contact=env.get("TILES_CONTACT", "configurable"),
        storage=env.get("TILES_STORAGE", "fs"),
        fs_root=Path(env.get("TILES_FS_ROOT", "data/tiles")),
        s3_bucket=env.get("TILES_S3_BUCKET", "tiles"),
        s3_prefix=env.get("TILES_S3_PREFIX", ""),
        s3_endpoint=env.get("TILES_S3_ENDPOINT") or None,
        s3_region=env.get("TILES_S3_REGION", "us-east-1"),
        s3_access_key=Secret(env.get("TILES_S3_ACCESS_KEY")),
        s3_secret_key=Secret(env.get("TILES_S3_SECRET_KEY")),
        negative_ttl_s=float(env.get("TILES_NEGATIVE_TTL_S", "300")),
        outage_ttl_s=float(env.get("TILES_OUTAGE_TTL_S", "15")),
        circuit_failures=int(env.get("TILES_CIRCUIT_FAILURES", "5")),
        circuit_cooldown_s=float(env.get("TILES_CIRCUIT_COOLDOWN_S", "30")),
        generation_deadline_s=float(env.get("TILES_GENERATION_DEADLINE_S", "10")),
        client_rate=float(env.get("TILES_CLIENT_RATE", "100")),
        client_burst=int(env.get("TILES_CLIENT_BURST", "400")),
        trust_forwarded_for=_bool(env.get("TILES_TRUST_FORWARDED_FOR"), False),
        log_level=env.get("TILES_LOG_LEVEL", "INFO"),
        diagnostico_dir=Path(env.get("TILES_DIAGNOSTICO_DIR") or DEFAULT_DIAGNOSTICO),
        metrics_enabled=_bool(env.get("TILES_METRICS"), True),
    )


def secret_values(settings: Settings, env: Mapping[str, str] | None = None) -> list[str]:
    """Every secret value known to the process, for log redaction."""
    env = os.environ if env is None else env
    values = [s.get() for s in (settings.s3_access_key, settings.s3_secret_key) if s.get()]
    for k, v in env.items():
        if v and len(v) >= 6 and re.search(r"(SECRET|PASSWORD|TOKEN|ACCESS_KEY|_KEY$)", k):
            values.append(v)
    return sorted(set(values), key=len, reverse=True)
