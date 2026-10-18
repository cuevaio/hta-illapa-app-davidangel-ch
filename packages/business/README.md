# Business logic

`@hack-the-andes-project/business` contains the shared fleet and road-risk rules used by the API, the fleet-sync and scraper Node services. Import from the package root or a module path such as `@hack-the-andes-project/business/fleet/evaluate-trip`.

## Modules and entry points

- `fleet/sync-connection.ts`: `syncConnection` decrypts a connection's credentials, imports vehicles and stores newer positions in batches. History IDs are deterministic across retries; older readings cannot overwrite a newer checkpoint. Provider errors become fixed, credential-free messages.
- `fleet/evaluate-trip.ts`: `evaluateTrip` updates ETAs, recalculates an off-route trip, completes arrivals within 300 m of the requested destination, and upserts hazard alerts. Existing acknowledgements and resolutions survive repeated evaluation.
- `fleet/resolve-obsolete-alerts.ts`: `resolveObsoleteAlerts` closes open and acknowledged alerts for ended trips, inactive/deleted incidents, or incidents whose category and severity no longer pass `ALERTABLE_INCIDENTS` (an accident that aged out of its alert window). API callers pass an organization ID; the trusted cron can reconcile all organizations.
- `fleet/plan-demo-trip.ts`: `planDemoTrip` picks a destination for a demo truck. The `hazard` scenario aims 10 km past the nearest active alertable incident 20 to 150 km away; the `clear` scenario tries 60 km destinations in the directions farthest from any incident. Each candidate costs one OSRM request and is accepted only if the route passes the incident, or no incident at all. It gives up after eight route attempts.
- `fleet/load-alertable-incidents.ts`: `loadAlertableIncidents` reads active incidents that pass `ALERTABLE_INCIDENTS`, for fleet-sync and demo trip planning.
- `fleet/prune-positions.ts`: `pruneVehiclePositions` removes up to 10,000 history rows older than 30 days. Vehicle checkpoints remain available.
- `hazards/`: `projectOntoRoute`, `findHazardsAhead`, `chooseAlternativeRoute`, `estimateEta`, and `isAlertableIncident`. A buffered route bounding box rejects distant geometry before buffering individual hazards. Polygon alerts remain active while the vehicle is inside the hazard.
- `routing/osrm.ts`: `fetchRouteCandidates` requests driving alternatives with full GeoJSON geometry, optionally through ordered `waypoints` (U-turns are allowed at them, or OSRM's car profile loops to the next turnaround). Requests time out after 15 seconds; HTTP failures and unusable routes are rejected.
- `route-review/evaluate.ts`: `evaluateRouteReview` backs `routeReview.evaluate`, the API behind Revisar ruta.
  - **ILLAPA paths:** it routes the graph three ways. The direct fastest path ignores closures, so an interruption on it shows up and reroutes. The fastest and the safest paths are routed with SUTRAN `interrumpido` closures blocked.
  - **SUTRAN detours:** they are added when their region's `interrumpido` stretch runs on the direct path; for Lima to Huancayo these are Rutas 1 to 5. Each detour is routed with OSRM through the midpoints of its fragments. Its axle limit is parsed from `restriccion` ("hasta N ejes").
- `route-review/assemble.ts`: `assembleRouteReview` is the pure part of the evaluation.
  - **Segments:** it splits each path into segments of about 5 km. A detour is first cut into 1 km pieces, and each piece takes the nearest road segment within 600 m.
  - **Risk per segment:** each segment scores its riskiest road segment for `now`, `24h`, `48h` and `72h`. `now` is `scoreCurrentRisk`: the stored components without forecast rain. Scores are rounded to whole points, and `very_high` maps to `critical`.
  - **Signals:**
    - `confirmed`: SUTRAN `interrumpido` and `restringido` incidents within 300 m.
    - `forecast`: official weather alerts that touch the path, plus segments that are `high` or worse inside the trip window.
    - `baseline`: segments with a static susceptibility of at least 0.6.
  - **Recommendation:** `recommendRoute` applies the PRD rule table. The trip window is the shortest stored horizon that covers arrival. Assessments keep only the wettest 24 h block, so a high forecast reroutes when an eligible, well-assessed path is lower, and otherwise delays without a suggested departure.
  - **Recommended path:** it is chosen among eligible, uninterrupted paths by `compareRouteCandidates`, preferring paths with at most 20% of their length unassessed.
  - **Deduplication:** a path on a detour's segments for 80% of its length is listed once, as the detour.
- `risk/score.ts`: `scoreSegmentRisk` is the heuristic index.
  - Static susceptibility: mass movement 40 %, terrain slope 20 %, fluvial flood × river proximity 25 %, nearby historical landslides and floods 15 %.
  - Rain trigger: the wettest forecast day inside the horizon, saturating at 25 mm, plus half-weighted 72 h antecedent rain, saturating at 60 mm. Dry days keep a 20 % floor.
  - Official alerts are added on top, and the result is scaled to 0–100.
  - Levels: `low` < 25, `moderate` < 50, `high` < 75, otherwise `very_high`. Missing static features use a 0.5 prior instead of 0.
- `risk/assess.ts`: `assessRoadRisk` scores every segment for 24, 48 and 72 h and upserts one row per segment and horizon.
  - Weather comes from Open-Meteo on a 0.1° grid, at most 100 cells per request, with one retry after a 429.
  - Polygon alerts apply by containment and point alerts within 2 km.
  - Segments whose weather cell failed keep their previous assessment.
  - When `model.generated.ts` holds a model, its probability is mapped to 0–100 through the training quantiles and official alerts are still added.
- `risk/compare-routes.ts` and `risk/route.ts`: `compareRiskAwareRoutes` loads the graph inside a box that grows with the trip (half its span, at least 0.3°).
  - Edges within 300 m of an active SUTRAN `interrumpido` incident are removed from the graph (`closedEdgeIds`). An edge whose road code differs from the closure's is kept. Edges with no code are still removed, because OSM sometimes lacks the `ref` on the closed road itself.
  - Only assessments whose `validUntil` is after `now` are used. Expired ones count as unassessed distance.
  - It runs ngraph.path A* for the fastest route and for a risk-penalized cost: travel time × (1 + 3 × score / 100).
  - Each route reports distance, duration, length-weighted mean risk, max risk, distance in `high` or worse, and unassessed distance. SUTRAN `alt_route` POIs are returned only when no route exists.
- `risk/weather.ts`, `risk/exposure.ts`, `risk/model.ts`: Open-Meteo parsing and windows, the spatial alert and history matching, and the model feature vector and quantile mapping, in the order `tools/risk-pipeline/illapa_risk/train.py` expects.
- `providers/`: `providerFor`, `gpsCredentialsSchema`, `geotabProvider`, and `samsaraProvider`. Geotab uses HTTPS MyGeotab hosts, follows validated federation hosts, and retries an expired session once. Samsara requires Read Vehicles and Read Vehicle Statistics permissions, uses Bearer authentication, and follows cursors with a 100-page cap per collection. `demoProvider` needs no credentials and imports the six trucks in `DEMO_VEHICLES`. For demo connections `syncConnection` uses `simulateDemoPositions` instead of a provider request. A truck with an active trip follows the trip route at the planned OSRM pace times `DEMO_TIME_ACCELERATION_FACTOR`, reports the unaccelerated speed and stops at the requested destination. An idle truck stays where it last stopped, or at its depot. The API runs the first demo sync when the connection is created.
- `crypto/`: `encryptJson`, `decryptJson`, and `generateEncryptionKeyBase64` use AES-256-GCM with a fresh IV. The key is 32 bytes encoded as base64; ciphertext is `base64(iv).base64(payload)`.
- `demo-request.ts`: validation for the public demo request form.

GeoJSON coordinates are `[longitude, latitude]`; application locations are `{ lat, lng }`. Distances are meters, route durations are seconds, speeds are km/h, and dates represent UTC instants. Geotab already reports metric speed; Samsara mph is converted at the adapter boundary.

Database operations receive a request-owned Drizzle connection. They do not start transactions on the shared mysql2 connection. Keep provider credentials and raw provider/SQL errors out of logs and procedure responses.

## Verification

```sh
pnpm --filter @hack-the-andes-project/business test
pnpm --filter @hack-the-andes-project/business check-types
```

Tests use provider fixtures and the real Drizzle SQL builder with a mocked driver. They do not contact GPS accounts or run writes against MySQL.
