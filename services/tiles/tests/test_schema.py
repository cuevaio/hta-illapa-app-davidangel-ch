"""Shared package packages/tiles-schema: committed OpenAPI matches the app; metadata schemas validate."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema

from tiles_service.app import create_app
from tiles_service.tilemath import lonlat_to_tile

SCHEMA_DIR = Path(__file__).resolve().parents[3] / "packages" / "tiles-schema"


def test_committed_openapi_matches_the_app(settings, fakes):
    committed = json.loads((SCHEMA_DIR / "openapi.json").read_text(encoding="utf-8"))
    generated = create_app(settings, adapters=fakes).openapi()
    assert committed == generated, "regenera con: uv run --project services/tiles tiles openapi --out packages/tiles-schema/openapi.json"


def test_tile_metadata_matches_json_schema(client, storage):
    schema = json.loads((SCHEMA_DIR / "tile-metadata.schema.json").read_text(encoding="utf-8"))
    x, y = lonlat_to_tile(-77.0428, -12.0464, 11)
    assert client.get(f"/tiles/terreno/v1/11/{x}/{y}").status_code == 200
    meta = json.loads(storage.get(f"terreno/v1/11/{x}/{y}.json"))
    jsonschema.validate(meta, schema)


def test_capas_matches_json_schema(client):
    schema = json.loads((SCHEMA_DIR / "capas.schema.json").read_text(encoding="utf-8"))
    jsonschema.validate(client.get("/capas").json(), schema)


def test_diagnostics_page_is_served(client):
    r = client.get("/diagnostico")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    assert "diagnostico-backend.js" in r.text
    js = client.get("/diagnostico/diagnostico-backend.js")
    assert js.status_code == 200 and "javascript" in js.headers["content-type"]
    assert client.get("/diagnostico/../config.py").status_code == 404
