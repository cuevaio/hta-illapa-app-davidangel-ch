# Seeding a fresh database

`pnpm db:push` creates the 22 `hack_the_andes_*` tables, all empty. Nothing in the repo copies rows from one database to another. Every row comes from one of three places: the running services, the offline risk pipeline, or people using the app. This file covers where each table's rows come from, the order that makes a new environment demo-ready, and what only the old database holds.

## Where each table's rows come from

"Regenerable" means a fresh environment can rebuild the table without the old database.

| Table | Written by | Regenerable |
| --- | --- | --- |
| `user` | better-auth: `POST /api/auth/sign-up/email`. `POST /api/auth/demo/sign-in` creates `demo@illapa.app` on first use (`packages/auth/src/demo.ts`). | Demo user: yes, on the first `/demo` visit. Real users: no, they sign up again. |
| `account` | better-auth email sign-up (`credential` provider, PBKDF2 password hash). The demo user has none. | No. No endpoint returns password hashes. |
| `session` | better-auth, on every sign-in. | Nothing to keep. Everyone signs in again. |
| `verification` | better-auth short-lived tokens. | Nothing to keep. |
| `rate_limit` | better-auth rate limiter (`rateLimit.storage: "database"`). | Nothing to keep. |
| `organization`, `member` | `ensurePersonalOrganization` (`packages/auth/src/organization.ts`), on a user's creation or first session. It creates a personal organization whose id is the user id, with the user as `owner`. Other organizations come from the better-auth organization plugin. | Personal ones come back when their owner signs up again, under new ids. Others: create them again. |
| `invitation` | better-auth organization plugin (`invite-member`). | No. Invite again. |
| `gps_connection` | `connections.create`: Geotab or Samsara credentials, validated with the provider and stored AES-256-GCM encrypted with `CREDENTIALS_ENCRYPTION_KEY`. Demo fleets come from `ensureDemoConnection` (`demo.prepare`, the demo reset, or `connections.create` with provider `demo`). | Demo: yes. Real: no, the credentials must be entered again. |
| `vehicle` | Imported when its connection is created. Fleet-sync (`*/2 * * * *`) upserts it with the latest position. | Yes, once its connection exists. Real vehicles get new random ids; demo trucks get deterministic ones. |
| `vehicle_position` | Fleet-sync appends rows on every run. The API runs a demo connection's first sync. Rows older than 30 days are pruned. | The history is lost. It restarts at the first sync. |
| `trip` | `trips.create`; `prepareDemo` (the two demo trips). Fleet-sync updates the ETA, reroutes, and completes the trip on arrival. | Demo: yes. Real: no, plan them again. |
| `alert` | Fleet-sync `evaluateTrip` (also once inside `trips.create`) and `alerts.acknowledge`. Alerts resolve on their own when the trip ends or the hazard is passed or no longer active. | Yes for active trips. Acknowledgement history is lost. |
| `incident` | Scraper. Every 5 min: `sutran_alerts`, `indeci_coen_emergencies`, `bomberos_emergencies_24h`, `senamhi_warnings`, `igp_last_earthquake`, `serfor_wildfire_alerts`. Hourly: `sratma_accidents` (last 30 days) and relevant `rpp_latest_news` articles, mirrored as incidents. | Current state: yes, one run of each schedule. Rows deactivated before the cutover: no. |
| `poi` | Scraper, daily at 09:00 UTC: `sutran_alt_routes`, `sutran_fire_stations`, `sutran_police_stations`, `sutran_health_facilities`, `sutran_bus_terminals`, `sutran_weighing_stations`, `indeci_relief_warehouses`. | Yes, with one daily run. |
| `news_article` | Scraper, hourly `rpp_latest_news`. It stores only articles new to RPP's listing, each classified once by Jev. | Only the roughly 30 articles currently listed. |
| `scrape_run` | Scraper: one row per source per run. | Operational log. It restarts empty. |
| `road_segment`, `road_node`, `road_edge` | `tools/risk-pipeline`: `illapa_risk.load` replaces all three. | Yes, by running the pipeline. No API exposes nodes or edges. |
| `segment_risk_assessment` | Scraper `POST /risk`, also fired by the hourly cron. `illapa_risk.load` deletes the rows of segments that no longer exist. | Yes: run `/risk` once after loading the road graph. |
| `risk_pipeline_run` | `illapa_risk.load`, one row per load. | Yes. Nothing reads it. |

## Runbook

Order matters in three places:

- The road graph must be loaded before `/risk` can score it.
- Incidents must exist before the demo trips are planned.
- The demo user must exist before a demo reset.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | `mysql://<user>:<password>@<host>:<port>/<database>` of the new MySQL, reachable from the machine running the command. URL-encode special characters in the password. |
| `API_URL`, `WEB_URL` | Public origins of the server and the dashboard. |
| `SCRAPER_URL`, `FLEET_SYNC_URL` | Base URLs of the scraper and fleet-sync HTTP listeners. They need not be public: run the `curl` commands from the box. |
| `SCRAPER_RUN_SECRET`, `FLEET_SYNC_RUN_SECRET`, `DEMO_RESET_SECRET` | The values configured on those services. |

### 0. Before you start

- **MySQL 8:** create one database and a user with all privileges on it. Keep the server time zone on UTC, which is the official image's default: don't set `TZ`, or pass `--default-time-zone=+00:00`. Drizzle reads and writes `timestamp` columns as UTC.
- **Secrets:** generate them per environment (each app's `.env.schema` lists them). `openssl rand -base64 32` gives a valid `BETTER_AUTH_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` (exactly 32 bytes), `SCRAPER_RUN_SECRET`, `FLEET_SYNC_RUN_SECRET` and `DEMO_RESET_SECRET`.
- **`CREDENTIALS_ENCRYPTION_KEY`:** server and fleet-sync must share the same value, and it must never change afterwards. If it changes, fleet-sync can no longer decrypt any connection, the demo connection included.
- **Third-party keys:** `JEV_API_KEY` and the B2 media keys belong to external services, so reuse the existing ones. The `illapa-media` bucket keeps its photos.
- **Server settings:**
  - Set `DEMO_RESET_SECRET`. Without it, `POST /api/demo/reset` answers 404 as if it did not exist.
  - `BETTER_AUTH_URL` is `API_URL`, and `ALLOWED_ORIGINS` contains `WEB_URL`.
  - Build the web image with `--build-arg VITE_SERVER_URL=$API_URL`.

### 1. Create the schema

From a checkout of the deployed commit, after `pnpm install`:

```sh
DATABASE_URL='mysql://illapa:<password>@127.0.0.1:3307/illapa' pnpm db:push
```

Varlock gives a variable set in the shell priority over `packages/db/.env`. If MySQL is only reachable from the box, open a tunnel first, for example `ssh -N -L 3307:<mysql-host>:3306 <user>@<box>`. `<mysql-host>` is `127.0.0.1` if the port is published on the box; otherwise use the container's IP from `docker inspect`. When the push finishes, the database holds 22 `hack_the_andes_*` tables.

### 2. Start the services

Deploy the server, scraper, fleet-sync and web. The Node services read the database from their own `DATABASE_URL` (`packages/node-runtime/src/cloudflare-workers.ts`), which uses MySQL's host on the Docker network rather than the tunnel used in steps 1 and 3. From then on, the crons fill `incident` within 5 minutes, and `news_article` and the SRATMA accidents within the hour. `poi` waits for 09:00 UTC and nothing loads the road graph, so steps 3 to 5 are done by hand.

### 3. Load the road graph

```sh
cd tools/risk-pipeline
uv sync
uv run python -m illapa_risk.build
```

`build` downloads the Geofabrik Peru extract (about 250 MB) and the Copernicus DEM tiles. It also samples two INGEMMET image services, with 2 × ⌈3 × segments ÷ 200⌉ `getSamples` requests. Every response is cached under `output/cache/`. The repo records no run time. Expect tens of minutes the first time, mostly downloads and INGEMMET requests, and minutes on a rerun that reads the cache. Any machine with uv, internet access and a route to MySQL will do. Owen ran the pipeline during development; if his `tools/risk-pipeline/output/` still exists, skip `build` and run only `load` from his checkout.

`load` ignores the environment and reads `DATABASE_URL` from `packages/db/.env` only. Point that file at the new database for the load; this overwrites any existing file:

```sh
printf 'DATABASE_URL=%s\n' "$DATABASE_URL" > ../../packages/db/.env
uv run --with cryptography python -m illapa_risk.load
```

`--with cryptography` is needed because a fresh MySQL 8 user authenticates with `caching_sha2_password`. Over a non-TLS connection, PyMySQL can only complete that handshake with the `cryptography` package, which `uv.lock` does not include. Without it, the load only works while MySQL still caches the user from an earlier login, such as step 1 or a running service.

`load` replaces `road_segment`, `road_node` and `road_edge` in one transaction and deletes orphaned assessments. It prints `Loaded run <id>: <n> segments, <n> nodes, <n> edges`. The graph covers only the Lima–Huancayo pilot box (`PILOT_AREA` in `illapa_risk/config.py`).

### 4. Run every scraper schedule once

```sh
for schedule in daily frequent hourly; do
  curl -sS -X POST -H "x-scraper-secret: $SCRAPER_RUN_SECRET" "$SCRAPER_URL/run?schedule=$schedule"
  echo
done
```

Each response lists every source with `ok`, `fetched`, `inserted`, `updated`, `deactivated` and `error`. HTTP 500 means at least one source failed; the others still wrote their rows. To rerun one source, use `?source=<id>` with an id from the table above. Expected behavior:

- `bomberos_emergencies_24h` fails on purpose when Bomberos serves a reCAPTCHA page instead of data.
- `rpp_latest_news` and recent `sratma_accidents` call Jev.
- The hourly run takes minutes, because SRATMA fetches one detail per accident of the last 30 days.

`?schedule=` fans out one request per source through `ENV.SELF` (`apps/scraper/src/index.ts`). On Node, `packages/node-runtime` sends those requests back to the scraper's own `PORT`. The manual hourly run does not score risk; only the hourly cron also calls `/risk`.

### 5. Score the road segments

```sh
curl -sS -X POST -H "x-scraper-secret: $SCRAPER_RUN_SECRET" "$SCRAPER_URL/risk"
```

Expect `"segments": N`, `"assessments": 3N` (24, 48 and 72 h) and `"weatherCellsFailed": 0`. Without a road graph, it returns zeros. Open-Meteo allows 600 cell calls per minute, so leave a minute between two runs. Route review and `risk.compareRoutes` treat expired assessments (`valid_until` in the past) as unassessed, so the hourly cron has to keep running.

### 6. Create and seed the demo account

Do this only after step 4: the hazard trip is planned against the incidents present at that moment.

1. Open `$WEB_URL/demo` once. It signs in as `demo@illapa.app`, which creates the user and its personal organization, and then calls `demo.prepare`. Without a browser:

   ```sh
   curl -sS -c demo-cookies.txt -X POST -H "Origin: $WEB_URL" -H 'Content-Type: application/json' -d '{}' "$API_URL/api/auth/demo/sign-in"
   curl -sS -b demo-cookies.txt -X POST -H 'Content-Type: application/json' -d '{}' "$API_URL/rpc/demo/prepare"
   ```

   `demo.prepare` answers `{"json":{"vehicleCount":6,"tripCount":2}}`. It creates:
   - The `Flota demo` connection, with credentials `{"provider":"demo"}` encrypted with `CREDENTIALS_ENCRYPTION_KEY`.
   - The six trucks of `DEMO_VEHICLES` (Callao, Ate, Lurín, Trujillo, Huancayo, Arequipa), each with one position at its depot.
   - "Demo: ruta con peligro". It uses the first truck by external id, Trujillo excluded, that has an active alertable incident (`ALERTABLE_INCIDENTS`) 20–150 km away on its OSRM route. The destination is 10 km past the incident, or the incident itself when that point cannot be routed.
   - "Demo: ruta despejada". The Trujillo truck goes to a point 60 km away, in the direction farthest from every incident, on a route with no hazard.

   It creates no alerts; fleet-sync does. A `tripCount` below 2 means a trip could not be planned. Usually no incident suits the hazard trip, or OSRM failed (`demo.tripPlanningFailed` on the request's wide event).

2. To wipe and reseed later:

   ```sh
   DEMO_RESET_SECRET=… DEMO_RESET_URL="$API_URL/api/demo/reset" pnpm demo:reset
   ```

   The equivalent call is `curl -sS -X POST -H "x-demo-reset-secret: $DEMO_RESET_SECRET" "$API_URL/api/demo/reset"`. The reset deletes the demo organization's alerts, trips, positions, vehicles and connections, keeps the user, organization and sessions, and runs `demo.prepare` again. It answers `{"vehicleCount":6,"tripCount":2}`. Errors:
   - 404 `{"error":"demo_not_found"}`: nobody has signed in to the demo yet. Do step 1 first.
   - Plain 404 `not_found`: the server has no `DEMO_RESET_SECRET`.
   - 401: wrong secret.

### 7. Run fleet-sync once

```sh
curl -sS -X POST -H "x-fleet-sync-secret: $FLEET_SYNC_RUN_SECRET" "$FLEET_SYNC_URL/run"
```

This moves the demo trucks, evaluates their trips and creates the hazard alert. The cron repeats it every 2 minutes.

### 8. Check

```sql
SELECT 'active incidents', COUNT(*) FROM hack_the_andes_incident WHERE active
UNION ALL SELECT 'active pois', COUNT(*) FROM hack_the_andes_poi WHERE active
UNION ALL SELECT 'news articles', COUNT(*) FROM hack_the_andes_news_article
UNION ALL SELECT 'road segments', COUNT(*) FROM hack_the_andes_road_segment
UNION ALL SELECT 'road edges', COUNT(*) FROM hack_the_andes_road_edge
UNION ALL SELECT 'assessments', COUNT(*) FROM hack_the_andes_segment_risk_assessment
UNION ALL SELECT 'vehicles', COUNT(*) FROM hack_the_andes_vehicle
UNION ALL SELECT 'active trips', COUNT(*) FROM hack_the_andes_trip WHERE status = 'active'
UNION ALL SELECT 'open alerts', COUNT(*) FROM hack_the_andes_alert WHERE status = 'open';

SELECT source, ok, fetched, error_message FROM hack_the_andes_scrape_run ORDER BY started_at DESC LIMIT 20;
```

In the dashboard, check for:

- Incidents and POIs on the map.
- The risk layer.
- The demo fleet with its two trips and an open alert.
- A Lima → Huancayo route review.

### Before showing the demo

Demo trucks drive at 10× the planned OSRM pace (`DEMO_TIME_ACCELERATION_FACTOR`). The hazard alert resolves as soon as the truck passes the incident. A trip completes at about a tenth of its route duration after it was created, usually within 5–20 minutes. Once every trip of the demo account has finished, the next fleet-sync run (at most two minutes later) or `/demo` visit restarts the demo with fresh trips, so it keeps looping without a manual reset. Use the reset in step 6 only to restart a demo whose trips are still running.

## What only the old database holds

The project's git history starts on 2026-10-17, so the old database holds less than a day of data. A fresh environment cannot rebuild:

- **Real accounts:** `user`, `account` (password hashes), extra organizations, `member` and `invitation`. People sign up again and owners re-invite their teams.
- **Real GPS connections:** no procedure returns their credentials, which are encrypted with the old `CREDENTIALS_ENCRYPTION_KEY`. Re-enter them in the new environment (`connections.create`), which imports the vehicles again.
- **History:** real trips, alert acknowledgements, `vehicle_position` (30 days), deactivated incidents, RPP articles older than the current listing, and `scrape_run`.

A signed-in user can read what the API exposes before the cutover. Organization-scoped procedures (connections, vehicles, trips, alerts, demo) return only the caller's active organization.

### Read procedures

The procedures are called as `POST $API_URL/rpc/<path>`, with the dots of the procedure path written as slashes. All except `healthCheck` need a session cookie. The request body is `{"json": <input>}`, or `{}` when the input is empty or every field has a default. Responses are `{"json": <output>, "meta": [...]}`; dates are ISO strings, flagged in `meta`.

| Procedure | Input | Returns | Tables |
| --- | --- | --- | --- |
| `connections.list` | none | `id`, `provider`, `label`, `status`, `lastSyncAt`, `lastError`, `vehicleCount`, `createdAt`. Never the credentials. | `gps_connection`, `vehicle` |
| `vehicles.list` | none | Every vehicle with its last position, `provider` and active trip. | `vehicle`, `gps_connection`, `trip` |
| `trips.list` | `{ status? }`: `active`, `completed` or `cancelled`. | Full trip rows (route geometry, origin, destination, ETA, status) with `vehicleName` and `openAlertCount`. | `trip`, `vehicle`, `alert` |
| `alerts.list` | `{ status? }`: `open` (default), `acknowledged` or `resolved`. | Alert rows with `tripName`, `vehicleName`, and the incident's id, title, category and geometry. | `alert`, `trip`, `vehicle`, `incident` |
| `incidents.list` | `{ bbox?, categories?, severities?, since?, limit? }`. `limit` is at most 2000 (default 500). | Active incidents only. | `incident` |
| `incidents.summary` | none | Active incident counts by category and by severity. | `incident` |
| `pois.list` | `{ kinds, bbox? }` | Active POIs. | `poi` |
| `news.list` | `{ limit?, relevantOnly? }`. `limit` is at most 200 (default 50); `relevantOnly` defaults to `true`. | Articles, newest first. | `news_article` |
| `risk.segments` | `{ horizonHours?, bbox?, roadCode?, minScore?, limit? }`. Horizon is 24, 48 or 72; `limit` is at most 10 000. | Segments with their static features and latest assessment. | `road_segment`, `segment_risk_assessment` |
| `risk.compareRoutes` | `{ origin, destination, horizonHours? }` | Computed fastest and risk-aware routes, closures and SUTRAN detours. | Reads `road_edge`, `road_node`, `segment_risk_assessment`, `incident`, `poi`. |
| `routeReview.evaluate` | `{ originPlaceId, destinationPlaceId, departureAt, vehicleAxleCount }` | A computed review. Nothing is stored. | Reads the graph, assessments, `incident`, `poi`. |
| `demo.prepare` | none | `{ vehicleCount, tripCount }`. Demo account only. | Writes the demo fleet. |
| `healthCheck`, `privateData` | none | `"OK"`; the session user. | None. |

### Write procedures

These recreate data in the new environment:

- `connections.create`: `{ label, credentials }`. `credentials` is one of:
  - `{ provider: "geotab", server?, database, userName, password }`
  - `{ provider: "samsara", apiToken }`
  - `{ provider: "demo" }`
- `connections.remove`: `{ id }`.
- `trips.create`: `{ vehicleId, name, destination: { lat, lng }, destinationName? }`. The origin is the vehicle's current position.
- `trips.planDemo`: `{ vehicleId, scenario: "hazard" | "clear" }`.
- `trips.cancel`, `trips.complete`: `{ id }`.
- `alerts.acknowledge`: `{ id }`.

### What is worth exporting

- **Connections, vehicles and trips:** export them as a checklist for recreating real fleets by hand. There is no import endpoint, and credentials never leave the old environment.
- **Alerts:** history only. New alerts come from fleet-sync.
- **News:** `news.list` with `relevantOnly: false` (at most 200 rows) is the only way to keep articles older than RPP's current listing. No endpoint can write them back.
- **Incidents, POIs and risk:** don't export them. The scrapers and the pipeline rebuild them, and no procedure exposes inactive incidents, nodes or edges.
- **Members and invitations:** these come from better-auth, not oRPC. `GET /api/auth/organization/get-full-organization` returns the active organization's.

### Export commands

```sh
API_URL=https://api.illapa.app
curl -sS -c old-session.txt -X POST "$API_URL/api/auth/sign-in/email" \
  -H 'Content-Type: application/json' -H 'Origin: https://dash.illapa.app' \
  -d '{"email":"<email>","password":"<password>"}'
for procedure in connections/list vehicles/list trips/list; do
  curl -sS -b old-session.txt -X POST "$API_URL/rpc/$procedure" \
    -H 'Content-Type: application/json' -d '{}' > "export-${procedure%/list}.json"
done
for status in open acknowledged resolved; do
  curl -sS -b old-session.txt -X POST "$API_URL/rpc/alerts/list" \
    -H 'Content-Type: application/json' -d "{\"json\":{\"status\":\"$status\"}}" > "export-alerts-$status.json"
done
curl -sS -b old-session.txt -X POST "$API_URL/rpc/news/list" \
  -H 'Content-Type: application/json' -d '{"json":{"limit":200,"relevantOnly":false}}' > export-news.json
curl -sS -b old-session.txt "$API_URL/api/auth/organization/get-full-organization" > export-organization.json
```

## Data outside MySQL

- **Demo request leads:** `illapa.app`'s demo request form writes leads to the Cloudflare KV namespace `hack-the-andes-illapa-demo-requests`. Keys are `<ISO time>:<uuid>`; values are JSON with the name, company, phone and email. The leads stay in Cloudflare, so export them before that namespace is deleted.
- **SRATMA photos:** they live in the Backblaze B2 bucket `illapa-media`. The scraper lists the bucket and links the stored photos again, so nothing is downloaded twice.
- **Route review data:** vehicle profiles and planned trips are stored in each browser's `localStorage` (`illapa-route-review-fixtures-v1`) for the dashboard's origin. They survive the move as long as the dashboard keeps its domain.
