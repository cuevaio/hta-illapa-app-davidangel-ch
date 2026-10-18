"""Optional integration test against the real sources (needs network).

Disabled by default and in CI. Enable with: TILES_TEST_RED=1
"""

from __future__ import annotations

import os

import numpy as np
import pytest

from tiles_service.adapters.copernicus import CopernicusGlo30Adapter
from tiles_service.adapters.terrain_tiles import TerrainTilesAdapter
from tiles_service.config import load_settings
from tiles_service.metrics import Metrics
from tiles_service.terrarium import decode_rgb
from tiles_service.tilemath import lonlat_to_tile
from tiles_service.upstream import UpstreamClient

pytestmark = [
    pytest.mark.red,
    pytest.mark.skipif(os.environ.get("TILES_TEST_RED") != "1", reason="requiere red: TILES_TEST_RED=1"),
]


def real_source(source_id):
    settings = load_settings({})  # default services/tiles/tilesets.yaml
    return settings.sources[source_id], settings


@pytest.mark.anyio
async def test_terrain_tiles_real_huascaran_above_6000():
    cfg, settings = real_source("terrain-tiles")
    adapter = TerrainTilesAdapter(cfg, UpstreamClient(cfg, contact=settings.contact, metrics=Metrics()))
    x, y = lonlat_to_tile(-77.6045, -9.1222, 11)
    tile = await adapter.fetch(11, x, y, max_real_zoom=11)
    assert np.nanmax(decode_rgb(tile.rgb)) > 6000


@pytest.mark.anyio
async def test_copernicus_real_lima_plausible():
    cfg, settings = real_source("copernicus-glo30")
    adapter = CopernicusGlo30Adapter(cfg, UpstreamClient(cfg, contact=settings.contact, metrics=Metrics()))
    x, y = lonlat_to_tile(-77.0428, -12.0464, 11)
    h = decode_rgb((await adapter.fetch(11, x, y, max_real_zoom=11)).rgb)
    assert -50 < np.nanmin(h) and np.nanmax(h) < 1500
