# Illapa risk pipeline

Offline Python pipeline for the predictive risk engine. It builds the road graph, the road segments and their static features, loads them into MySQL, and trains the optional ML model. The Workers handle the live part: the scraper's hourly job scores segments, and the API routes over the graph (see `packages/business/src/risk`).

## Steps

```sh
cd tools/risk-pipeline
uv sync                                   # Python 3.12 env
uv run python -m illapa_risk.build        # graph + segments + features → output/
uv run python -m illapa_risk.load         # replace the risk tables in MySQL
```

`build` reads OpenStreetMap from the Geofabrik Peru extract (`peru-YYMMDD.osm.pbf`, about 250 MB), downloaded once per day into `output/cache/geofabrik/`. The public Overpass servers throttle and block the ~25 sub-queries the pilot area needs, so the extract replaces them. Every other HTTP response is cached under `output/cache/http/`. Delete `output/cache/` to force fresh data.

`load` reads `DATABASE_URL` from `packages/db/.env`. In one transaction it replaces `road_segment`, `road_node` and `road_edge`, deletes assessments of segments that no longer exist, and records a `risk_pipeline_run`. It touches no other table. Run `pnpm db:migrate` first so the tables exist.

## Sources

| Variable | Source | Notes |
| --- | --- | --- |
| Road graph (nodes, directed edges, travel time) | OpenStreetMap (Geofabrik extract) via pyosmium and OSMnx | motorway to tertiary, plus links, in the Lima–Huancayo pilot box (`config.PILOT_AREA`), which also covers the Canta and Cañete–Yauyos corridors |
| Segments | Derived | One road (OSM `ref`, or a hash of the name) per 1 km UTM 18S cell; both directions of an edge share a segment |
| Elevation and terrain slope | Copernicus DEM GLO-90, 1° tiles from AWS open data sampled locally (the DEM behind Open-Meteo's elevation API, whose per-coordinate quota is too small) | Slope uses central differences 150 m around the segment centre, so it is hillside slope, not road grade |
| Mass-movement susceptibility | INGEMMET `SERV_IMG_SUSCEP_MOV_MASA` ImageServer | Classes 1 (muy baja) to 5 (muy alta); the worst of 3 samples along the segment |
| Fluvial flood susceptibility | INGEMMET `SERV_IMG_SUSCEP_INUN_FLUVIAL` ImageServer | Classes 1–4. **Assumption:** they rise with susceptibility (the service publishes no legend) |
| Distance to water | OSM `waterway=river` (same extract) | `null` when no river lies within 5 km |
| Precipitation (forecast and last 72 h) | Open-Meteo forecast API | Fetched live by the scraper Worker on a 0.1° grid |
| Official alerts and closures | SENAMHI, INDECI and SUTRAN | Already ingested by `apps/scraper`. SUTRAN `interrumpido` incidents block graph edges, and SUTRAN `alt_route` POIs are the fallback detours |

Pending sources:

- NASA GPM IMERG needs an Earthdata account. Open-Meteo is the precipitation source until one is configured.
- CENEPRED SIGRID needs a login. INGEMMET susceptibility covers the same hazard.

## ML model

```sh
brew install libomp                       # LightGBM's OpenMP runtime on macOS
uv sync --extra train
uv run --extra train python -m illapa_risk.train
```

`train` builds segment-days for PE-3N, PE-5N, PE-5NA and PE-22. Each row holds the static features, rain over the 3-day window ending on day d, rain on day d+1 (observed, used as a perfect-forecast proxy), the month, and the validated events seen before d+1. The label is whether a validated event hit the segment on d+1. Labels come from `output/labels.parquet` (columns `date`, `lat`, `lng`, `category`, `source`), written by `uv run python -m illapa_risk.labels`. That command reads INDECI COEN emergencies since 2023-01-09 and keeps:

- huaicos, derrumbes and deslizamientos as `landslide`;
- fluvial floods as `flood`.

It drops "lluvias intensas" reports, which describe the rain itself and would leak the rain feature into the label. It also drops points shared by five or more events, which are district centroids that cannot be tied to a road. Training rain comes from the Open-Meteo archive (ERA5, 0.25°) for the November–April wet seasons only, which keeps the request volume inside Open-Meteo's free daily quota.

It runs one leave-one-route-out fold per route. The model is exported with m2cgen to `packages/business/src/risk/model.generated.ts` only when it beats the heuristic on average precision and ROC AUC on **every** held-out route that has events. The export also carries out-of-fold probability quantiles, which map probabilities onto the same relative 0–100 index the heuristic uses. `output/training-report.json` records the comparison either way.

The heuristic score is mirrored in `train.heuristic_score`. Update it whenever `packages/business/src/risk/score.ts` changes.

## Caveats

Scores are relative indices meant to support decisions, not calibrated probabilities. Check the official SENAMHI, INDECI and SUTRAN alerts, and how recent each assessment is (`assessedAt`, `weatherFetchedAt`), before acting on a score.
