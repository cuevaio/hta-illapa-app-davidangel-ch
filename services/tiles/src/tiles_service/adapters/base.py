"""`UpstreamAdapter`: the common interface every source implements."""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any

import numpy as np

TILE_SIZE = 512


class TileNotFound(Exception):
    """The source has no data for this tile (cached briefly as a negative entry)."""


class SourceUnavailable(Exception):
    """The source failed (network, 5xx, budget, deadline). Cached only briefly (outage cache) when `outage` is true."""

    outage = True  # False when the failure is congestion of a live source (see breaker.CircuitBreaker.record_failure)


@dataclass
class AdapterTile:
    rgb: np.ndarray  # (512, 512, 3) uint8, Terrarium encoded (internal format)
    overzoom: bool = False
    upstream: dict[str, Any] = field(default_factory=dict)  # e.g. last-modified, imagery sources


class UpstreamAdapter(abc.ABC):
    """Fetches one internal 512 px tile (z, x, y) from a source and normalises it.

    A 512 px tile z/x/y covers the extent of the standard 256 px XYZ tile z/x/y.
    For z > max_real_zoom the adapter resamples data of max_real_zoom and sets overzoom=True.
    """

    source_id: str
    PLANNED_TRANSFORM: str = ""

    @abc.abstractmethod
    async def fetch(self, z: int, x: int, y: int, max_real_zoom: int) -> AdapterTile: ...

    async def aclose(self) -> None:
        client = getattr(self, "client", None)
        if client is not None and hasattr(client, "aclose"):
            await client.aclose()
