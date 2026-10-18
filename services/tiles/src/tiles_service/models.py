"""Pydantic models: they generate the OpenAPI document and the shared JSON Schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Error(BaseModel):
    error: str = Field(description="Mensaje en español; nunca incluye rutas internas ni credenciales.")


class Bbox(BaseModel):
    oeste: float
    sur: float
    este: float
    norte: float


class Formato(BaseModel):
    codificacion: str = Field(description="terrarium")
    formula: str = Field(description="h = R*256 + G + B/256 - 32768 (metros)")
    unidad: str
    tamano_px: int
    mime: str
    nodata_rgb: list[int] = Field(description="RGB de 'sin datos' (decodifica a -32768)")
    nodata_umbral_m: float = Field(description="Toda altura decodificada <= este valor es 'sin datos'")


class Fuente(BaseModel):
    id: str
    nombre: str
    atribucion: str
    licencia: str
    licencia_url: str
    resolucion_nativa_m: float | None
    modelo_superficie: bool = Field(description="true si es un modelo digital de superficie (DSM: incluye vegetación y edificios)")
    fecha_datos: str | None
    precarga_permitida: bool


class VersionCapa(BaseModel):
    version: str
    url: str = Field(description="Plantilla XYZ relativa a la API")
    zoom_min: int
    zoom_max: int
    zoom_max_real: int = Field(description="Nivel máximo con datos reales; por encima se sirve sobremuestreo marcado")
    transformacion: dict[str, Any]
    descripcion: str
    formato: Formato
    fuente: Fuente
    limitaciones: list[str]
    huella: str = Field(description="Huella de fuente+transformación; cambiarla exige una versión nueva")


class Capa(BaseModel):
    id: str
    nombre: str
    tipo: str
    version_actual: str
    versiones: list[VersionCapa]


class Capas(BaseModel):
    bbox: Bbox
    cabeceras_tile: list[str] = Field(description="Cabeceras de metadatos de cada tile (expuestas por CORS)")
    capas: list[Capa]


class TileMetadata(BaseModel):
    """Metadatos guardados junto a cada tile (`.json`) y devueltos como cabeceras X-Tile-*."""

    capa: str
    version: str
    z: int = Field(ge=0, le=22)
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    min: float | None = Field(description="Altura mínima (m), sin contar 'sin datos'; null si todo es 'sin datos'")
    max: float | None = Field(description="Altura máxima (m), sin contar 'sin datos'")
    fuente: str
    fecha: str = Field(description="Fecha de generación ISO 8601 UTC")
    fecha_datos: str | None = Field(description="Fecha de los datos de la fuente, si se conoce")
    sobremuestreo: bool = Field(description="true si z > zoom_max_real (no es dato real)")
    modelo_superficie: bool
    formato: str
    huella: str
    sha256: str
    bytes: int
    origen: dict[str, Any] = Field(default_factory=dict)
    revisado: str | None = None


class CircuitoFuente(BaseModel):
    circuito: str = Field(description="cerrado (normal) | abierto (fuente caída: 503 inmediato sin consultarla) | "
                                      "semiabierto (se permite una petición de prueba)")
    fallos_consecutivos: int
    aperturas: int = Field(description="Veces que se abrió el circuito desde el arranque")
    reintento_en_s: float | None = Field(description="Segundos hasta la próxima prueba; null si está cerrado")


class Salud(BaseModel):
    estado: str = Field(description="ok | degradado (almacenamiento caído, conflicto de versión o circuito de una fuente no cerrado)")
    version: str
    almacenamiento: str
    almacenamiento_ok: bool
    capas: dict[str, dict[str, str]]
    fuentes: dict[str, CircuitoFuente] = Field(default_factory=dict, description="Estado del circuito por fuente")
