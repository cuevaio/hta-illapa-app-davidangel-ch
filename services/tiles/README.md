# services/tiles — backend de tiles con caché de lectura

API HTTP que sirve tiles de altura del Perú desde un almacenamiento propio (MinIO/S3/R2 o disco) y, en un
fallo de caché, los genera desde la fuente, los guarda y los devuelve. Contrato: [`docs/api-tiles.md`](../../docs/api-tiles.md);
esquemas compartidos: [`packages/tiles-schema`](../../packages/tiles-schema). Atribución: [`ATRIBUCIONES.md`](../../ATRIBUCIONES.md).

## Stack y por qué

| Pieza | Elección | Motivo |
|---|---|---|
| Lenguaje / API | Python 3.12 + FastAPI 0.143 + Uvicorn | Las próximas fases necesitan transformaciones geoespaciales (reproyección, clases mayoritarias, vías) que viven en el ecosistema Python/GDAL; FastAPI genera el OpenAPI desde los mismos modelos que validan. |
| Lectura COG | rasterio 1.5.2 (GDAL 3.12 en la rueda) | Lectura por ventanas con HTTP range (`/vsicurl/`), *overviews* y `reproject`; ya validado en la Fase 6.0 contra Copernicus GLO-30. rio-tiler no hace falta: solo se usa una ventana y una reproyección por celda. |
| Fuente HTTP | httpx 0.28 con `h2` | Cliente asíncrono con *keep-alive* y HTTP/2 cuando el servidor lo ofrece (S3 responde HTTP/1.1). |
| Imagen | numpy + Pillow | Mosaico y codificación Terrarium sin pérdidas. |
| Almacenamiento | boto3 (S3 compatible) o disco | MinIO en local; R2/S3 cambiando solo variables de entorno. |
| Métricas | prometheus-client | `GET /metrics` en formato de texto Prometheus. |

Versiones fijadas en `pyproject.toml` y `uv.lock`.

## Ejecutar

Con Docker (backend + MinIO):

```sh
docker compose up -d --build        # API en http://127.0.0.1:8080, consola MinIO en http://127.0.0.1:9001
open http://127.0.0.1:8080/diagnostico
docker compose --profile prewarm run --rm prewarm      # precalentamiento z0–z9 (TILES_PREWARM_ZMAX)
docker compose down                 # parar (añade -v para borrar también los tiles guardados)
```

Sin Docker (almacenamiento en disco, `data/tiles`):

```sh
uv run --project services/tiles tiles serve --port 8080
uv run --project services/tiles pytest services/tiles/tests -q            # pruebas (sin red)
TILES_TEST_RED=1 uv run --project services/tiles pytest services/tiles/tests -q -m red   # integración real (red)
```

## Configuración

Secretos **solo** por variables de entorno (o el gestor de secretos del despliegue); nunca en `tilesets.yaml`,
en el código, en los registros (se redactan) ni en los tiles.

| Variable | Por defecto | Uso |
|---|---|---|
| `TILES_STORAGE` | `fs` | `fs` (disco) o `s3` (MinIO, S3, R2). |
| `TILES_FS_ROOT` | `data/tiles` | Carpeta de tiles con `fs`. |
| `TILES_S3_ENDPOINT` / `TILES_S3_BUCKET` / `TILES_S3_PREFIX` / `TILES_S3_REGION` | — / `tiles` / — / `us-east-1` | Destino S3 compatible (sin endpoint = AWS S3). |
| `TILES_S3_ACCESS_KEY` / `TILES_S3_SECRET_KEY` | — | Credenciales (secretos). |
| `TILES_CONTACT` | `configurable` | Contacto en el User-Agent `xr-simulator-tiles/0.1.0 (contact: …)`. |
| `TILES_CORS_ORIGINS` | `http://localhost:5173,…` | Orígenes permitidos, separados por comas. |
| `TILES_BBOX` | `-81.5,-18.5,-68.5,0.2` | Caja oeste,sur,este,norte; fuera de ella → 404. |
| `TILES_ZOOM_MAX` | `14` | Nivel máximo global aceptado en `tilesets.yaml`. |
| `TILES_CLIENT_RATE` / `TILES_CLIENT_BURST` | `100` / `400` | Límite por cliente (peticiones/s, ráfaga). |
| `TILES_TRUST_FORWARDED_FOR` | `false` | Usar `X-Forwarded-For` como cliente (solo detrás de un proxy propio). |
| `TILES_NEGATIVE_TTL_S` | `300` | Caché negativa para tiles inexistentes en la fuente. |
| `TILES_OUTAGE_TTL_S` | `15` | Caché breve de fallos por caída de la fuente (503 inmediato para ese tile; `0` la desactiva). |
| `TILES_GENERATION_DEADLINE_S` | `10` | Plazo total por generación de tile (incluye reintentos); al agotarse → 503. `plazo_generacion_s` en `tilesets.yaml` lo sustituye por fuente (Copernicus: `TILES_COP_DEADLINE_S`, `20`). `0` = sin plazo. |
| `TILES_CIRCUIT_FAILURES` / `TILES_CIRCUIT_COOLDOWN_S` | `5` / `30` | Circuito por fuente: fallos consecutivos para abrirlo y espera antes de la petición de prueba. |
| `TILES_CONNECT_TIMEOUT_S` | `3` | Timeout de conexión (`timeout_conexion_s`); `timeout_s` sigue siendo el de lectura. |
| `TILES_TILESETS` | `services/tiles/tilesets.yaml` | Fichero declarativo de fuentes y versiones. |
| `TILES_TERRAIN_TILES_URL`, `TILES_COPERNICUS_URL` | buckets públicos de AWS | Espejos de la fuente (no cambian la huella de la versión). |
| `TILES_TT_RATE`, `TILES_COP_RATE`, `TILES_*_BUDGET_*` | ver `tilesets.yaml` | Tasa por fuente y presupuestos diarios. |
| `TILES_LOG_LEVEL`, `TILES_METRICS` | `INFO`, `true` | Registros JSON por stderr; `/metrics` activado. |

### Configurar fuentes

Cada fuente en `tilesets.yaml` declara tipo de adaptador (`terrain_tiles`, `copernicus_glo30`; esqueletos
`worldcover`, `roads`), atribución, licencia, resolución nativa, si es modelo de superficie, si permite precarga,
tasa (`tasa_por_s`, `rafaga`), concurrencia, reintentos con espera creciente (`espera_inicial_s · 2^intento`,
respetando `Retry-After`), *timeout* y presupuesto diario (`peticiones_dia`, `bytes_dia`; al superarlo se registra
un aviso y `tiles_budget_exceeded=1`; con `bloquear_al_exceder: true` además se deja de consultar la fuente).

## Versionar un tileset

`capas.<capa>.versiones.<vN>` fija fuente, transformación y niveles. Las URL incluyen la versión, así que
los tiles son inmutables (`Cache-Control: public, max-age=31536000, immutable`). **Cambiar la fuente o la
transformación exige una versión nueva**: el servicio guarda una huella en `<capa>/<vN>/_tileset.json` y
responde 503 a una versión cuya configuración ya no coincide. Para publicar un cambio: añade `v2`, despliega,
precalienta `v2`, cambia `version_actual` y el cliente; borra `v1` cuando nadie la use.

## Regenerar y purgar

```sh
tiles purgar --capa terreno --version v1          # solo esa versión (conserva la huella)
tiles purgar --capa terreno                       # toda la capa; el resto de capas no se toca
tiles regenerar --capa terreno --version v1 --zmax 9   # purga y vuelve a precalentar
tiles precalentar --capa terreno --version v1 --zmin 0 --zmax 9 --informe informe.json
```

(En Docker: `docker compose exec tiles tiles purgar …`.) La precarga solo se permite en fuentes con
`precarga_permitida: true` (Terrain Tiles); Copernicus se genera bajo demanda y OSM nunca se precarga.

### Precalentamiento medido (2026-10-18, Terrain Tiles → MinIO, tasa 20 peticiones/s, 8 en paralelo)

| Niveles (512 px) | Tiles | Guardado | Peticiones a la fuente | Bytes de la fuente | Tiempo |
|---|---|---|---|---|---|
| z0–z8 | 220 (z8: 150) | 75,9 MB | 820 | 71,1 MB | 39 s |

Nivel de despliegue recomendado: **z0–z9** (equivale a los datos de z1–z10 de 256 px, medidos en `docs/viabilidad.md`
en ≈206 MB): +532 tiles, estimado ≈ +160–180 MB y ≈ 2 min más con la misma tasa. Es el valor por defecto del
perfil `prewarm`. z10 añadiría 2 090 tiles (≈ 8 400 peticiones, ≈ 500 MB) y no se precalienta.

## Desplegar en almacenamiento de objetos con CDN

Solo cambia la configuración: `TILES_STORAGE=s3`, `TILES_S3_ENDPOINT=https://<cuenta>.r2.cloudflarestorage.com`
(o sin endpoint para AWS S3), `TILES_S3_BUCKET`, credenciales desde el gestor de secretos y `TILES_CORS_ORIGINS`
con el origen de la app. Pon la CDN delante de este servicio (las respuestas llevan `Cache-Control` inmutable y
`ETag`; la clave de caché es la URL, que ya contiene capa y versión). Los objetos PNG se guardan también con
`Cache-Control` inmutable, por lo que el bucket puede servirse directamente por la CDN para HIT si se desea,
manteniendo este servicio para los fallos. Activa `TILES_TRUST_FORWARDED_FOR=true` solo si el proxy reescribe esa cabecera.

## Observabilidad

`/metrics`: `tiles_requests_total{cache}` (HIT/MISS/STALE/NEGATIVE/ERROR), `tiles_cache_hit_ratio`,
`tiles_miss_latency_seconds`, `tiles_upstream_requests_total`, `tiles_upstream_fetches_total`,
`tiles_upstream_errors_total`, `tiles_upstream_bytes_total`, `tiles_egress_bytes_total`, `tiles_storage_bytes`,
`tiles_storage_written_bytes_total`, `tiles_upstream_budget_used`, `tiles_budget_exceeded`, `tiles_client_rejected_total`,
`tiles_circuit_state{source}` (0 cerrado, 1 semiabierto, 2 abierto), `tiles_circuit_opened_total{source}`,
`tiles_fast_failures_total{source,reason}` (`circuito`, `caida_reciente`), `tiles_generation_timeouts_total{source}`.
Registros JSON (una línea por evento: `arranque`, `miss`, `fuente_error`, `presupuesto`, `version_conflicto`…), con
redacción de cualquier valor secreto (también `circuito` y `plazo`). `/salud` devuelve `ok` o `degradado` (almacenamiento
caído, conflicto de versión o circuito de una fuente no cerrado) y `fuentes.<id>`: `circuito`, `fallos_consecutivos`,
`aperturas`, `reintento_en_s`.

### Fuente caída: fallo rápido y cortés

- Los tiles guardados se sirven siempre (`HIT`/`STALE`), con el circuito abierto o no; no se intenta revalidar con el circuito abierto.
- Cada generación tiene un plazo total (`TILES_GENERATION_DEADLINE_S`, 10 s) por debajo del timeout de 30 s del cliente.
- Circuito por fuente: tras `TILES_CIRCUIT_FAILURES` fallos consecutivos (errores de red, timeouts, 5xx/429 o plazo agotado)
  se abre: los tiles no guardados responden 503 al instante con `Retry-After` y no se consulta la fuente; las peticiones en
  cola o en reintento se cortan. Pasado `TILES_CIRCUIT_COOLDOWN_S` deja pasar una sola generación de prueba: si responde
  (incluido 404) se cierra; si falla vuelve a abrirse. Un fallo no cuenta si la fuente respondió después de que empezara
  (cola por el límite de tasa, no caída).
- Un tile que falló por caída responde 503 inmediato durante `TILES_OUTAGE_TTL_S` (15 s), distinto de la caché de 300 s de
  "tile inexistente"; se olvida al cerrarse el circuito.
- Medido (2026-10-18, imagen local, fuente en `http://10.255.255.1`): primer tile no guardado 503 en 7,6 s (antes ~83 s);
  los siguientes en 3–6 ms; ráfaga de 16 tiles en paralelo: todos 503 en ≤ 3,6 s; tile guardado 200 `HIT` en 4 ms;
  prueba semiabierta fallida en 3,5 s.

## Limitaciones

- **Resolución**: los datos reales son de ~30 m (SRTM 1″ en Terrain Tiles; GLO-30). Nivel máximo real **z11 en tiles
  de 512 px** (= z12 de 256 px, 36–38 m/px en Perú). z12–z14 se sirven como **sobremuestreo** (`X-Tile-Overzoom: 1`).
- **Copernicus GLO-30 es un modelo de superficie (DSM)**: incluye vegetación y edificios (Amazonía y ciudades más
  altas). Datum EGM2008; el de Terrain Tiles no está documentado. Diferencias medidas entre ambas: −9 a +4 m.
- Terrain Tiles está congelado desde 2017 y sin SLA; Copernicus solo desde el backend (sin CORS) y desde z8.
- `tiles_storage_bytes` es una estimación (escaneo al arrancar + escrituras); la caché negativa y la coalescencia
  son por proceso (con varias réplicas, cada una consulta como máximo una vez por tile).
- Los bytes descargados por GDAL desde Copernicus no se cuentan en `tiles_upstream_bytes_total` (sí las lecturas).
- La caja de Perú se contrastó con Natural Earth 10 m, no con GADM.
- **Artefactos de SRTM sobre ríos amazónicos (capa `terreno`)**: picos y pozos aislados de cientos de metros en
  píxeles sueltos sobre el Amazonas y el Itaya (p. ej. −315 m y +677 m en el tile `terreno/v1/11/607/1045`, Iquitos).
  Están en la fuente (Terrain Tiles `terrarium/12/1215/2091`, píxel fila 122 columna 76, ≈ −73,187 −3,819;
  `x-amz-meta-x-imagery-sources: srtm/S04W074.tif`); Copernicus da ≈ 81 m en el mismo sitio. No se corrigen: la
  versión `v1` conserva los bytes RGB de la fuente; un filtrado sería una transformación nueva (`v2`). Para la
  Amazonía usa `terreno-copernicus` o descarta valores fuera de rango en el cliente.
- El circuito, la caché de caídas y el plazo son por proceso (con varias réplicas, cada una abre su propio circuito).
