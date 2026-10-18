"""Integration with the real NOAA buckets (skipped unless WEATHER_TEST_RED=1)."""

import datetime as dt
import os

import httpx
import pytest

from weather_service.clouds.service import CloudPolicy, CloudService
from weather_service.config import Settings
from weather_service.http import Fetcher
from weather_service.products import TEMPERATURE_2M
from weather_service.service import WeatherService
from weather_service.store import Store

pytestmark = [
    pytest.mark.red,
    pytest.mark.skipif(os.environ.get("WEATHER_TEST_RED") != "1", reason="network test: set WEATHER_TEST_RED=1"),
]


async def test_a_complete_gfs_cycle_is_published(tmp_path):
    s = Settings(cache_dir=tmp_path)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        svc = WeatherService(Fetcher(client), Store(tmp_path), [TEMPERATURE_2M], s.grid(), [0, 3])
        cycle = await svc.select_cycle()
    assert cycle is not None and dt.datetime.now(dt.timezone.utc) - cycle < dt.timedelta(hours=30)


async def test_newest_goes_scan_is_listed(tmp_path):
    s = Settings(cache_dir=tmp_path)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        svc = CloudService(Fetcher(client), tmp_path, s.cloud_grid(), CloudPolicy())
        keys = await svc._recent_masks(dt.datetime.now(dt.timezone.utc), [])
        partner = await svc._ir_partner(keys[min(1, len(keys) - 1)][0], [])
    assert keys and keys[0][1] > 1_000_000
    assert partner is not None
