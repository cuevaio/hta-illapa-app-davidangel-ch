# services/weather — backend de capas meteorológicas

Sirve al cliente las capas meteorológicas sobre Perú: temperatura, viento, precipitación y potencial convectivo
(pronóstico NOAA GFS 0,25°), rayos observados (GOES-19 GLM) y nubes observadas (GOES-19 ABI). Es un port del backend
`services/weather` y del script `scripts/clouds/goes_clouds.py` de peru-simulator, con el mismo comportamiento; la
imagen de nubes pasa a ser un producto más del servicio (antes era un script manual que escribía en `public/`).

El navegador solo habla con esta API (vía el proxy de Vite `/weather-api`); el servicio descarga de los buckets
públicos de NOAA en AWS, sin credenciales. Referencia de endpoints: [`docs/api-weather.md`](../../docs/api-weather.md).

## Stack

FastAPI + uvicorn, Python 3.12 gestionado con uv (el Python 3.14 del sistema falla al verificar certificados HTTPS;
usar siempre `uv run`). GRIB2 con las ruedas binarias de ecCodes (`eccodes` + `eccodeslib`, sin bibliotecas del
sistema), NetCDF4/HDF5 con h5py, PNG con Pillow. Sin GDAL.

## Ejecutar

```sh
docker compose up -d --build weather          # http://127.0.0.1:8788, caché en el volumen weather-cache
uv run --project services/weather weather serve --port 8788   # sin Docker (caché en services/weather/.cache)
uv run --project services/weather pytest services/weather/tests -q     # pruebas (sin red)
WEATHER_TEST_RED=1 uv run --project services/weather pytest services/weather/tests -q -m red   # contra NOAA real
```

El servicio de Docker es independiente de tiles/MinIO. En el host se publica en 8788 (no en 8787, que usa el backend
de peru-simulator); dentro del contenedor escucha en 8787. Otro puerto: `WEATHER_HOST_PORT=<puerto> docker compose up -d
weather` y arrancar Vite con `WEATHER_API_URL=http://127.0.0.1:<puerto>`. Salud: `GET /api/health` (`ok` y el estado de cada capa).

## Configuración (entorno)

| Variable | Defecto | Uso |
| --- | --- | --- |
| `WEATHER_BBOX` | `-81.5,-18.5,-68.5,0.2` | caja base oeste,sur,este,norte (la de `services/tiles`, `PERU_BBOX`) |
| `WEATHER_MARGIN` | `2` | grados añadidos alrededor de la caja (todas las capas cubren caja + margen) |
| `WEATHER_PRODUCTS` | `gfs-t2m,gfs-wind10m,gfs-precip,gfs-cape` | productos GFS activos |
| `WEATHER_FHOURS` | `0-48:3` | horas de pronóstico (17 tiempos) |
| `WEATHER_GRID_WIDTH` | `256` | ancho de las rejillas GFS en píxeles |
| `WEATHER_CACHE_DIR` | `services/weather/.cache` (`/data/cache` en Docker) | caché en disco |
| `WEATHER_REFRESH` | `1` | `0`: servir solo la caché, sin descargas |
| `WEATHER_RETRIES` | `3` | reintentos con espera exponencial ante 5xx/red |
| `WEATHER_LIGHTNING` | `1` | `0`: desactiva los rayos |
| `WEATHER_GLM_WINDOW_MIN` / `_BACKFILL_MIN` / `_POLL_S` | `60` / `60` / `60` | ventana móvil, relleno inicial, sondeo |
| `WEATHER_CLOUDS` | `1` | `0`: desactiva las nubes |
| `WEATHER_CLOUDS_WIDTH` | `2048` | ancho de la imagen de nubes |
| `WEATHER_CLOUDS_POLL_S` | `600` | intervalo de refresco de nubes (cadencia ABI de disco completo) |
| `WEATHER_CLOUDS_KEEP` | `6` | imágenes de nubes guardadas en disco |
| `WEATHER_CLOUDS_IR` / `_IR_BAND` | `1` / `13` | sombreado con IR (banda 13, 10,3 µm); `0` = solo máscara (~26 MB menos por escaneo) |
| `WEATHER_CLOUDS_BLUR` / `_HOURS_BACK` | `1.4` / `3` | suavizado gaussiano; horas hacia atrás para buscar escaneos |
| `WEATHER_CLOUDS_SAMPLE_DIR` | `services/weather/sample` | muestra servida mientras no hay imagen propia |
| `WEATHER_GFS_BASE_URL` / `WEATHER_GLM_BASE_URL` / `WEATHER_GOES_BASE_URL` | buckets NOAA | orígenes (pruebas o espejos) |
| `WEATHER_CORS_ORIGINS` | vacío (compose: orígenes de Vite) | orígenes CORS si el cliente no usa el proxy |
| `WEATHER_HOST` / `WEATHER_PORT` / `WEATHER_LOG_LEVEL` | `127.0.0.1` / `8787` / `INFO` | servidor |

### Caja geográfica

Por defecto se usa la caja de `services/tiles` + 2° = oeste −83,5, sur −20,5, este −66,5, norte 2,2. peru-simulator
usaba `PERU_BOUNDS` (−81,4, −18,4, −68,6, 0,0) + 2°, es decir 0,1–0,2° menos por lado; se eligió la de tiles para que
clima y terreno usen la misma referencia. La muestra de nubes comprometida (`sample/`) conserva la extensión de
peru-simulator (−83,4..−66,6, −20,4..2,0): el cliente debe usar siempre los `lonLatBounds`/`mercatorBounds` de la
respuesta, no suponerlos.

## Productos

- **`gfs-t2m`** (pronóstico): temperatura a 2 m, °C. **`gfs-wind10m`**: viento a 10 m, bandas `u`, `v` en m/s.
  **`gfs-precip`**: bandas `rate` (mm/h, media de la ventana de 3 h que termina en el tiempo válido) y `accum` (mm
  desde el inicio del ciclo). **`gfs-cape`**: CAPE de superficie, J/kg (categorías 250/1000/2500).
- **`glm-lightning`** (observado): destellos GLM de buena calidad dentro de la caja, ventana móvil de 60 min.
- **`goes-clouds`** (observado): imagen PNG gris + alfa en Web Mercator (2048 × 2789 px) con la probabilidad de nube
  ABI (ACM) sombreada con la temperatura de brillo IR de la banda 13; proyección propia del fixed grid ABI (PUG vol. 3
  §4.2.8), sin GDAL.

## Volúmenes y tiempos medidos (2026-10-18, arranque en frío en Docker, ciclo GFS 2026-10-18 06 UTC)

| Producto | Descarga | Tiempo |
| --- | --- | --- |
| `gfs-t2m` | 10,5 MB (17 mensajes) | 13,7 s |
| `gfs-wind10m` | 29,3 MB | 17,3 s |
| `gfs-precip` | 9,4 MB | 18,3 s |
| `gfs-cape` | 9,9 MB | 19,3 s |
| `glm-lightning` | 47,7 MB (179 ficheros, 60 min) | 14,9 s; luego ~3 ficheros / ~1 MB por minuto |
| `goes-clouds` | 50,5 MB (máscara + IR de un escaneo) | 28,1 s; luego lo mismo cada 10 min |

Todo listo unos 30 s después de arrancar (los productos se descargan en paralelo). Caché en disco tras el arranque:
~123 MB. En régimen: ~60 MB por ciclo GFS (cada 6 h), ~60 MB/h de GLM y ~300 MB/h de nubes (≈7 GB/día de tráfico
de entrada; `WEATHER_CLOUDS_IR=0` lo reduce a la mitad, `WEATHER_CLOUDS_POLL_S` más alto lo reduce más).

## Refresco y caché

- **GFS**: un planificador por producto elige el ciclo más reciente (00/06/12/18 UTC, hasta 4 atrás) cuyos `.idx`
  existen para todas las horas, descarga solo los mensajes necesarios por rangos HTTP (`Range`) y los remuestrea a
  Web Mercator. Duerme hasta ciclo + 6 h + 4 h de publicación y luego sondea cada 10 min. Se guardan los 2 últimos
  ciclos (`raw/gfs/…`, `products/…`, manifiesto escrito al final); al reiniciar se restaura el último completo.
- **GLM**: cada minuto lista las horas del bucket que solapan la ventana, baja solo ficheros nuevos y guarda los
  destellos recortados en `glm/*.npz` (no el fichero original); poda lo que sale de la ventana.
- **Nubes**: cada 10 min lista la hora ACMF más reciente; usa el escaneo más nuevo con fichero IR (el IR suele salir
  antes; si ninguno de los 3 últimos lo tiene, solo máscara). Si es el mismo escaneo ya servido no descarga nada.
  Guarda `clouds/images/<escaneo>.png` + `.json` (el JSON al final) y conserva las últimas `WEATHER_CLOUDS_KEEP`; de
  los NetCDF solo los del escaneo actual (`clouds/raw/`). Antes de la primera imagen sirve la muestra comprometida
  con `fallback: true`.
- Errores: se conserva el último dato bueno (`status: stale`, `error` con el motivo); espera de 1 a 30 min.

## Limitaciones

- **GFS es un pronóstico** de modelo global de 0,25° (~28 km), no una observación; en los Andes suaviza mucho el
  relieve (temperatura y viento a 2/10 m sobre el terreno del modelo, no el real).
- **CAPE es potencial**, no tormentas observadas: indica energía disponible para convección si algo la dispara.
- **Rayos GLM**: ventana móvil (60 min por defecto) que termina ahora; al arrancar puede cubrir menos
  (`coverageStart`). GLM detecta mejor de noche que con sol fuerte; píxel ~8–14 km.
- **Nubes**: un escaneo cada 10 min con ~10–20 min de retraso de publicación; píxel ABI de ~2 km (IR); la máscara no
  distingue tipos de nube. No se usa la banda visible de 0,5 km (~280 MB por fichero y oscura de noche).
- Tráfico: ver arriba; sin límite de tasa propio hacia NOAA (bucket público de AWS Open Data).

## Atribución

Ver [`ATRIBUCIONES.md`](../../ATRIBUCIONES.md). Cada capa la publica en `GET /api/layers` (`source`, `attribution`).
