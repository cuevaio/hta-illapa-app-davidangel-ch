"""Shared fixtures for the tiles backend tests (no network by default)."""

from __future__ import annotations

import asyncio
import textwrap
from pathlib import Path

import numpy as np
import pytest

from tiles_service.adapters.base import AdapterTile, SourceUnavailable, TileNotFound, UpstreamAdapter
from tiles_service.app import create_app
from tiles_service.config import load_settings
from tiles_service.storage import FileStorage
from tiles_service.terrarium import encode_heights

LIMA_Z11 = (11, 585, 1092)  # contains Lima (-77.04, -12.05)

TEST_TILESETS = textwrap.dedent(
    """
    fuentes:
      fake:
        tipo: fake
        nombre: Fuente simulada
        atribucion: "Datos simulados"
        licencia: CC0
        licencia_url: https://creativecommons.org/publicdomain/zero/1.0/
        resolucion_nativa_m: 30
        modelo_superficie: false
        fecha_datos: "2017-11-12"
        precarga_permitida: true
      fake2:
        tipo: fake
        nombre: Otra fuente simulada
        atribucion: "Otros datos simulados"
        licencia: CC0
        resolucion_nativa_m: 30
        modelo_superficie: true
        precarga_permitida: false
    capas:
      terreno:
        nombre: Terreno de prueba
        tipo: altura
        versiones:
          v1:
            fuente: fake
            zoom_min: 0
            zoom_max: 14
            zoom_max_real: 11
            transformacion: {tamano: 512, remuestreo: bilinear}
          v2:
            fuente: fake2
            zoom_min: 0
            zoom_max: 14
            zoom_max_real: 11
            transformacion: {tamano: 512, remuestreo: bilinear}
      terreno-copernicus:
        nombre: Respaldo de prueba
        tipo: altura
        versiones:
          v1:
            fuente: fake2
            zoom_min: 8
            zoom_max: 14
            zoom_max_real: 11
            transformacion: {tamano: 512}
    """
)


class FakeAdapter(UpstreamAdapter):
    """Upstream double that counts calls and can be switched off."""

    def __init__(self, source_id: str, height: float = 100.0, delay: float = 0.0):
        self.source_id = source_id
        self.height = height
        self.delay = delay
        self.calls = 0
        self.down = False
        self.missing = False

    async def fetch(self, z: int, x: int, y: int, max_real_zoom: int) -> AdapterTile:
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.down:
            raise SourceUnavailable("fuente simulada caída")
        if self.missing:
            raise TileNotFound("no existe")
        heights = np.full((512, 512), self.height, dtype=np.float32)
        heights[0, 0] = self.height - 50
        heights[-1, -1] = self.height + 50
        return AdapterTile(rgb=encode_heights(heights), overzoom=z > max_real_zoom)


def write_tilesets(tmp_path: Path, text: str = TEST_TILESETS) -> Path:
    path = tmp_path / "tilesets.yaml"
    path.write_text(text, encoding="utf-8")
    return path


def make_settings(tmp_path: Path, text: str = TEST_TILESETS, **env: str):
    base = {
        "TILES_TILESETS": str(write_tilesets(tmp_path, text)),
        "TILES_STORAGE": "fs",
        "TILES_FS_ROOT": str(tmp_path / "store"),
        "TILES_CONTACT": "pruebas@example.org",
        "TILES_CLIENT_RATE": "1000",
        "TILES_CLIENT_BURST": "1000",
    }
    base.update(env)
    return load_settings(base)


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def fakes():
    return {"fake": FakeAdapter("fake", 100.0), "fake2": FakeAdapter("fake2", 900.0)}


@pytest.fixture
def settings(tmp_path):
    return make_settings(tmp_path)


@pytest.fixture
def storage(settings):
    return FileStorage(settings.fs_root)


@pytest.fixture
def app(settings, storage, fakes):
    return create_app(settings, storage=storage, adapters=fakes)


@pytest.fixture
def client(app):
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c
