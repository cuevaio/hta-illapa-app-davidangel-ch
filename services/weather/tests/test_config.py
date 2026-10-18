"""Settings from the environment: bbox shared with services/tiles, cloud product options, health."""

import pytest
from fastapi.testclient import TestClient

from weather_service.api import create_app
from weather_service.config import TILES_PERU_BBOX, Settings, parse_bbox


def test_default_bbox_is_the_tiles_peru_bbox_plus_two_degrees():
    s = Settings()
    assert s.bbox == TILES_PERU_BBOX == (-81.5, -18.5, -68.5, 0.2)
    assert s.margin == 2.0
    b = s.grid().lonlat_bounds()
    assert (b["west"], b["south"], b["east"], b["north"]) == pytest.approx((-83.5, -20.5, -66.5, 2.2))


def test_bbox_and_margin_from_env(monkeypatch):
    monkeypatch.setenv("WEATHER_BBOX", "-80, -10, -70, -5")
    monkeypatch.setenv("WEATHER_MARGIN", "1")
    s = Settings.from_env()
    assert s.bbox == (-80.0, -10.0, -70.0, -5.0)
    b = s.grid().lonlat_bounds()
    assert (b["west"], b["south"], b["east"], b["north"]) == pytest.approx((-81, -11, -69, -4))
    # The cloud image covers exactly the same extent as the GFS grids, at its own width.
    c = s.cloud_grid()
    assert c.width == s.clouds_width
    assert (c.min_x, c.min_y, c.max_x, c.max_y) == pytest.approx((s.grid().min_x, s.grid().min_y, s.grid().max_x, s.grid().max_y))


@pytest.mark.parametrize("text", ["-80,-10,-70", "-70,-10,-80,-5", "-80,-5,-70,-10", "a,b,c,d", "-80,-10,-70,89"])
def test_bad_bbox_is_rejected(text):
    with pytest.raises(ValueError):
        parse_bbox(text)


def test_cloud_settings_from_env(monkeypatch):
    monkeypatch.setenv("WEATHER_CLOUDS", "0")
    monkeypatch.setenv("WEATHER_CLOUDS_POLL_S", "120")
    monkeypatch.setenv("WEATHER_CLOUDS_KEEP", "3")
    monkeypatch.setenv("WEATHER_CLOUDS_WIDTH", "1024")
    monkeypatch.setenv("WEATHER_CLOUDS_IR", "0")
    s = Settings.from_env()
    assert (s.clouds, s.clouds_poll_seconds, s.clouds_keep, s.clouds_width, s.clouds_ir) == (False, 120, 3, 1024, False)
    d = Settings()
    assert (d.clouds, d.clouds_poll_seconds, d.clouds_keep, d.clouds_width, d.clouds_ir) == (True, 600, 6, 2048, True)


def test_health_reports_every_layer_status(tmp_path):
    app = create_app(Settings(refresh=False, cache_dir=tmp_path, products=("gfs-t2m",), lightning=False, clouds=False))
    with TestClient(app) as client:
        body = client.get("/api/health").json()
    assert body["ok"] is True
    assert body["layers"] == {"gfs-t2m": "idle"}
