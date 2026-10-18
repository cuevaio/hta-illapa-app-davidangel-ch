"""Settings from environment variables (all optional)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .clouds.service import GOES_BUCKET_URL
from .gfs import BUCKET_URL, parse_fhours
from .glm import GLM_BUCKET_URL
from .grid import PERU_BBOX, MercatorGrid

#: services/weather (editable install from src/; /app in the container image).
SERVICE_DIR = Path(__file__).resolve().parents[2]
#: The Peru bbox of services/tiles (west, south, east, north), so weather and terrain line up.
TILES_PERU_BBOX = PERU_BBOX

Bbox = tuple[float, float, float, float]


def parse_bbox(text: str) -> Bbox:
    """"west,south,east,north" in degrees; raises ValueError when malformed or inverted."""
    parts = [p.strip() for p in text.split(",")]
    if len(parts) != 4:
        raise ValueError(f"WEATHER_BBOX needs 4 values west,south,east,north, got {text!r}")
    west, south, east, north = (float(p) for p in parts)
    if not (-180 <= west < east <= 180 and -85 <= south < north <= 85):
        raise ValueError(f"WEATHER_BBOX out of range or inverted: {text!r}")
    return west, south, east, north


def _csv(text: str) -> tuple[str, ...]:
    return tuple(p.strip() for p in text.split(",") if p.strip())


@dataclass(frozen=True)
class Settings:
    cache_dir: Path = SERVICE_DIR / ".cache"
    #: Forecast hours, e.g. "0-48:3".
    fhours: tuple[int, ...] = tuple(parse_fhours("0-48:3"))
    products: tuple[str, ...] = ("gfs-t2m", "gfs-wind10m", "gfs-precip", "gfs-cape")
    grid_width: int = 256
    #: Base Peru bbox (west, south, east, north); every layer covers it plus `margin` degrees.
    bbox: Bbox = TILES_PERU_BBOX
    #: Degrees around `bbox` (same margin as the peru-simulator cloud pipeline).
    margin: float = 2.0
    retries: int = 3
    refresh: bool = True
    gfs_base_url: str = BUCKET_URL
    #: Observed lightning (GOES-19 GLM): rolling window, cold-start backfill and poll interval.
    lightning: bool = True
    glm_base_url: str = GLM_BUCKET_URL
    glm_window_minutes: int = 60
    glm_backfill_minutes: int = 60
    glm_poll_seconds: int = 60
    #: GOES-19 ABI cloud image (ACM mask + band 13 IR), refreshed every `clouds_poll_seconds`.
    clouds: bool = True
    goes_base_url: str = GOES_BUCKET_URL
    clouds_width: int = 2048
    clouds_poll_seconds: int = 600
    #: Generated images kept on disk (newest first); raw NetCDF of the current scan only.
    clouds_keep: int = 6
    clouds_ir: bool = True
    clouds_ir_band: int = 13
    clouds_blur: float = 1.4
    clouds_hours_back: int = 3
    #: Committed sample served while no image has been generated yet.
    clouds_sample_dir: Path = SERVICE_DIR / "sample"
    #: Browser origins allowed by CORS (the Vite proxy needs none).
    cors_origins: tuple[str, ...] = ()

    def grid(self) -> MercatorGrid:
        return MercatorGrid.peru(self.grid_width, self.margin, self.bbox)

    def cloud_grid(self) -> MercatorGrid:
        return MercatorGrid.peru(self.clouds_width, self.margin, self.bbox)

    @staticmethod
    def from_env() -> "Settings":
        env = os.environ
        d = Settings()
        return Settings(
            cache_dir=Path(env.get("WEATHER_CACHE_DIR", d.cache_dir)),
            fhours=tuple(parse_fhours(env["WEATHER_FHOURS"])) if "WEATHER_FHOURS" in env else d.fhours,
            products=_csv(env.get("WEATHER_PRODUCTS", ",".join(d.products))),
            grid_width=int(env.get("WEATHER_GRID_WIDTH", d.grid_width)),
            bbox=parse_bbox(env["WEATHER_BBOX"]) if env.get("WEATHER_BBOX") else d.bbox,
            margin=float(env.get("WEATHER_MARGIN", d.margin)),
            retries=int(env.get("WEATHER_RETRIES", d.retries)),
            refresh=env.get("WEATHER_REFRESH", "1") != "0",
            gfs_base_url=env.get("WEATHER_GFS_BASE_URL", d.gfs_base_url),
            lightning=env.get("WEATHER_LIGHTNING", "1") != "0",
            glm_base_url=env.get("WEATHER_GLM_BASE_URL", d.glm_base_url),
            glm_window_minutes=int(env.get("WEATHER_GLM_WINDOW_MIN", d.glm_window_minutes)),
            glm_backfill_minutes=int(env.get("WEATHER_GLM_BACKFILL_MIN", d.glm_backfill_minutes)),
            glm_poll_seconds=int(env.get("WEATHER_GLM_POLL_S", d.glm_poll_seconds)),
            clouds=env.get("WEATHER_CLOUDS", "1") != "0",
            goes_base_url=env.get("WEATHER_GOES_BASE_URL", d.goes_base_url),
            clouds_width=int(env.get("WEATHER_CLOUDS_WIDTH", d.clouds_width)),
            clouds_poll_seconds=int(env.get("WEATHER_CLOUDS_POLL_S", d.clouds_poll_seconds)),
            clouds_keep=int(env.get("WEATHER_CLOUDS_KEEP", d.clouds_keep)),
            clouds_ir=env.get("WEATHER_CLOUDS_IR", "1") != "0",
            clouds_ir_band=int(env.get("WEATHER_CLOUDS_IR_BAND", d.clouds_ir_band)),
            clouds_blur=float(env.get("WEATHER_CLOUDS_BLUR", d.clouds_blur)),
            clouds_hours_back=int(env.get("WEATHER_CLOUDS_HOURS_BACK", d.clouds_hours_back)),
            clouds_sample_dir=Path(env.get("WEATHER_CLOUDS_SAMPLE_DIR", d.clouds_sample_dir)),
            cors_origins=_csv(env.get("WEATHER_CORS_ORIGINS", "")),
        )
