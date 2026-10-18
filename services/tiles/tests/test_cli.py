"""Purge/regenerate by layer or version without touching the rest; prewarm."""

from __future__ import annotations

import pytest

from tiles_service.cli import purge, prewarm
from tiles_service.service import TileService
from tiles_service.storage import FileStorage

from conftest import FakeAdapter, make_settings


def seed(storage):
    for key in ("terreno/v1/1/0/1.png", "terreno/v1/1/0/1.json", "terreno/v2/1/0/1.png",
                "terreno-copernicus/v1/8/1/1.png"):
        storage.put(key, b"data", "application/octet-stream")


def keys(storage):
    return sorted(k for k, _ in storage.list_prefix(""))


def test_purge_by_version_keeps_other_versions_and_layers(tmp_path):
    settings = make_settings(tmp_path)
    storage = FileStorage(settings.fs_root)
    seed(storage)
    n = purge(settings, storage, "terreno", "v1")
    assert n == 2
    assert keys(storage) == ["terreno-copernicus/v1/8/1/1.png", "terreno/v2/1/0/1.png"]


def test_purge_by_layer_keeps_other_layers(tmp_path):
    settings = make_settings(tmp_path)
    storage = FileStorage(settings.fs_root)
    seed(storage)
    purge(settings, storage, "terreno", None)
    assert keys(storage) == ["terreno-copernicus/v1/8/1/1.png"]


def test_purge_rejects_unknown_layer(tmp_path):
    settings = make_settings(tmp_path)
    with pytest.raises(SystemExit):
        purge(settings, FileStorage(settings.fs_root), "nope", None)


@pytest.mark.anyio
async def test_prewarm_generates_coarse_levels_over_peru(tmp_path):
    settings = make_settings(tmp_path)
    storage = FileStorage(settings.fs_root)
    fake = FakeAdapter("fake")
    service = TileService(settings, storage, {"fake": fake, "fake2": FakeAdapter("fake2")})
    report = await prewarm(service, "terreno", "v1", zmin=0, zmax=3, concurrency=4)
    # Peru bbox: z0 1, z1 2, z2 2, z3 2 tiles (512 px tiles share the XYZ grid of 256 px)
    assert report["tiles"] == 7 and report["generated"] == 7 and fake.calls == 7
    assert report["bytes"] > 0 and report["seconds"] >= 0
    again = await prewarm(service, "terreno", "v1", zmin=0, zmax=3, concurrency=4)
    assert again["generated"] == 0 and again["cached"] == 7 and fake.calls == 7


@pytest.mark.anyio
async def test_prewarm_refuses_sources_that_forbid_it(tmp_path):
    settings = make_settings(tmp_path)
    service = TileService(settings, FileStorage(settings.fs_root), {"fake": FakeAdapter("fake"), "fake2": FakeAdapter("fake2")})
    with pytest.raises(SystemExit):
        await prewarm(service, "terreno", "v2", zmin=0, zmax=2, concurrency=2)
