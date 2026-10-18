"""Roads from the regional OSM extract (skeleton, implemented in Phase 8)."""

from __future__ import annotations

from ..config import SourceConfig
from .base import AdapterTile, UpstreamAdapter


class RoadsAdapter(UpstreamAdapter):
    PLANNED_TRANSFORM = (
        "Fuente: extracto regional Geofabrik peru-latest.osm.pbf (ODbL, ~245 MB), descargado de forma programada y "
        "verificado con su MD5; nunca teselas de los servidores de OSM ni precarga contra ellos. Transformación prevista: "
        "filtrar las vías por clase (highway=motorway/trunk/primary/secondary/tertiary/... y caminos) y por nivel de "
        "zoom (clases mayores en niveles gruesos, todas desde z12), simplificar geometrías por nivel y generar teselas "
        "vectoriales MVT propias (tileset versionado), servidas por esta misma caché. Atribución: '© OpenStreetMap "
        "contributors' (ODbL)."
    )

    def __init__(self, cfg: SourceConfig, client=None):
        self.source_id = cfg.id
        self.cfg = cfg
        self.client = client

    async def fetch(self, z: int, x: int, y: int, max_real_zoom: int) -> AdapterTile:
        raise NotImplementedError("Las vías se implementan en la Fase 8: " + self.PLANNED_TRANSFORM)
