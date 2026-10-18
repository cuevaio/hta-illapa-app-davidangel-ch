# @xr-simulator/tiles-schema

Contrato compartido entre el backend de tiles (`services/tiles`) y el cliente (Fase 7).

| Fichero | Contenido |
|---|---|
| `openapi.json` | Documento OpenAPI 3.1 de la API (`/tiles/{capa}/{versionTileset}/{z}/{x}/{y}`, `/capas`, `/salud`, `/metrics`). |
| `tile-metadata.schema.json` | JSON Schema de los metadatos guardados junto a cada tile (y devueltos como cabeceras `X-Tile-*`). |
| `capas.schema.json` | JSON Schema de la respuesta de `GET /capas`. |
| `types.ts` | Tipos TypeScript generados de los esquemas (`Capas`, `TileMetadata`, `Salud`, `Error`…). |

Los ficheros se **generan** desde los modelos de FastAPI/pydantic; no se editan a mano:

```sh
uv run --project services/tiles tiles esquemas --out-dir packages/tiles-schema
```

La prueba `tests/tiles/test_schema.py` falla si `openapi.json` no coincide con la aplicación.

`types.ts` son los tipos TypeScript de esos esquemas, que usa el cliente (`src/map/tilesClient.ts`). También es generado:

```sh
npm run schema:types
```

La prueba `tests/schemaTypes.test.ts` falla si `types.ts` no coincide con los JSON.
Formato de tile y reglas de versionado: [`docs/api-tiles.md`](../../docs/api-tiles.md).
