"""ESA WorldCover (skeleton, implemented in Phase 8)."""

from __future__ import annotations

from ..config import SourceConfig
from .base import AdapterTile, UpstreamAdapter


class WorldCoverAdapter(UpstreamAdapter):
    PLANNED_TRANSFORM = (
        "Fuente: ESA WorldCover v200 (2021) capa Map, COG uint8 EPSG:4326 de 3x3 grados (10 m, nombre por esquina "
        "inferior izquierda, p. ej. ESA_WorldCover_10m_2021_v200_S15W078_Map.tif), lectura por ventanas con HTTP range "
        "desde el backend (sin CORS). Transformación prevista: reproyectar a la rejilla Web Mercator del tile de 512 px "
        "y reducir por clase mayoritaria (moda de los píxeles de origen que caen en cada píxel de destino), sin "
        "interpolación: los códigos de clase (10, 20, ... 100) se conservan tal cual; 0 = sin datos. Formato de salida: "
        "PNG de 1 canal (L) con el código de clase. Atribución CC BY 4.0: '© ESA WorldCover project 2021 / Contains "
        "modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium'."
    )

    def __init__(self, cfg: SourceConfig, client=None):
        self.source_id = cfg.id
        self.cfg = cfg
        self.client = client

    async def fetch(self, z: int, x: int, y: int, max_real_zoom: int) -> AdapterTile:
        raise NotImplementedError("WorldCover se implementa en la Fase 8: " + self.PLANNED_TRANSFORM)
