# Illapa dashboard plan

## Product

Fleet operators log in at their environment's dashboard URL, see Peru with the incidents the scraper already stores (SUTRAN, INDECI, Bomberos, SENAMHI, IGP, SERFOR, RPP news), connect their GPS provider (Geotab, Samsara; more later), see each truck with its ETA, and get alerted when a truck is heading into a weather or road hazard, with an alternative route when one exists.

## Architecture decisions

- **Map**: MapLibre GL via `react-map-gl/maplibre`, OpenFreeMap tiles (no key). Map components live in `packages/ui`.
- **Routing engine**: OSRM HTTP API (`OSRM_BASE_URL`, default public demo `https://router.project-osrm.org`). `alternatives=true` gives candidate routes; the hazard engine picks the one that avoids hazards.
- **Business logic** lives in `packages/business` (`@hack-the-andes-project/business`): hazard engine, ETA, routing client, GPS provider adapters, credential encryption. Apps only orchestrate.
- **Tenancy**: better-auth `organization` plugin. A personal organization is auto-created on sign-up and set active. Every fleet row carries `organizationId`.
- **Credentials at rest**: AES-GCM (WebCrypto) with `CREDENTIALS_ENCRYPTION_KEY` (base64, 32 bytes). Server encrypts on create; fleet-sync decrypts to poll.
- **Fleet sync**: Node service `apps/fleet-sync` on a `*/2 * * * *` cron: pull positions from every active connection, then evaluate every active trip against active incidents, upserting `alert` rows. Alerts are in-app first (dashboard polls); email/push later.
- **Geometry**: GeoJSON columns, `@turf/*` for every spatial operation.

## Schema (`packages/db/src/schema/fleet.ts`, all through `mysqlTable`, no FKs)

- `gps_connection`: id, organizationId, provider (`geotab`|`samsara`), label, encryptedCredentials (text), status (`active`|`error`), lastSyncAt, lastError, createdAt, updatedAt. idx organizationId.
- `vehicle`: id, organizationId, connectionId, externalId, name, plate, lastLat, lastLng, lastHeading, lastSpeedKmh, lastPositionAt, active, createdAt, updatedAt. unique(connectionId, externalId), idx organizationId.
- `vehicle_position`: id, vehicleId, lat, lng, speedKmh, heading, recordedAt. idx(vehicleId, recordedAt).
- `trip`: id, organizationId, vehicleId, name, originLat, originLng, destinationLat, destinationLng, destinationName, routeGeometry (json LineString), routeDistanceM, routeDurationS, status (`planned`|`active`|`completed`|`cancelled`), etaAt, lastEvaluatedAt, createdAt, updatedAt. idx(organizationId, status), idx vehicleId.
- `alert`: id, organizationId, tripId, vehicleId, incidentId, kind (`hazard_ahead`), severity, title, message, distanceAheadM, etaToHazardAt, alternativeRoute (json `{ geometry, distanceM, durationS }` | null), status (`open`|`acknowledged`|`resolved`), createdAt, acknowledgedAt, resolvedAt. unique(tripId, incidentId), idx(organizationId, status).
- better-auth organization tables: `organization`, `member`, `invitation` (+ `activeOrganizationId` on `session`).

## Business package surface (`packages/business/src`)

- `crypto.ts`: `encryptJson(key, value)`, `decryptJson(key, ciphertext)`.
- `routing/osrm.ts`: `fetchRouteCandidates(baseUrl, origin, destination)` → `RouteCandidate[]` (`geometry: LineString`, `distanceM`, `durationS`).
- `hazards/`: `projectOntoRoute`, `findHazardsAhead`, `chooseAlternativeRoute`, `estimateEta`, `isAlertableIncident`, with constants (`HAZARD_BUFFER_M`, `LOOKAHEAD_M`, alertable category/severity table).
- `providers/`: `GpsProvider` interface (`validateCredentials`, `listVehicles`, `fetchLatestPositions`), `geotab.ts`, `samsara.ts`, `index.ts` (`providerFor(kind)`), zod credential schemas.

## API (`packages/api/src/routers`)

- `incidents.list({ bbox?, categories?, severities?, since? })`, `pois.list({ kinds })`, `news.list({ limit })` (read existing scraper tables).
- `connections.list/create/remove/syncNow`, `vehicles.list`, `trips.list/create/cancel`, `alerts.list/acknowledge`. All organization-scoped via `session.activeOrganizationId`.

## Web (`apps/web`)

Routes under `/_auth/dashboard`: map (incidents + fleet overlay), fleet (vehicles, create trip by picking a destination), alerts (open alerts, alternative route overlay, acknowledge), settings/connections (add Geotab / Samsara). Alerts poll every 30 s and toast on new ones.

## Infra

- One EC2 box runs Dokploy: production deploys from `main`, staging from `develop`.
- Server, scraper and fleet-sync are Node 24 services. Dashboard and marketing are nginx static sites. URLs come from Dokploy env and build args; production runs on `dash.getillapa.com` and `api.getillapa.com` (issue #7).
- MySQL 8.4 holds `illapa` and `illapa_staging`, with `hack_the_andes_` table prefixes. Fleet-sync reads `DATABASE_URL`, the shared encryption key, `OSRM_BASE_URL` and its run secret from Dokploy.

## Work breakdown and model assignment

| # | Task | Model | Wave |
|---|------|-------|------|
| T1 | Hazard engine + ETA + OSRM client (pure, tested) | Fable 5.1 medium | 1 |
| T2 | Geotab + Samsara adapters + credential crypto (tested) | Opus 5.5 medium | 1 |
| T3 | Fleet schema + better-auth organization plugin | Astra xhigh | 1 |
| T4 | Read-only API: incidents / pois / news | Astra xhigh | 1 |
| T6 | Infra: service env and build scripts | Astra xhigh | 1 |
| T5 | Web dashboard shell + MapLibre incident map | Astra xhigh | 2 |
| T7 | Fleet API: connections, vehicles, trips, alerts | Astra xhigh | 2 |
| T8 | fleet-sync service (poll + evaluate + alerts) + infra | Astra xhigh | 2 |
| T9 | Web: connections, fleet, trips, alerts UI | Astra xhigh | 3 |
| T10 | Integration review, fixes, READMEs | Astra xhigh | 3 |

## Operations

Dokploy deploys `develop` to staging and `main` to production; see [the deployment runbook](../deploy/README.md). For schema changes, edit `packages/db/src/schema`, run `pnpm db:generate --name <change>`, and include the generated migration with the change. Never hand-edit migrations or use `db:push` against a shared database. The server applies pending migrations on boot before listening; scraper and fleet-sync do not migrate.

Set `CREDENTIALS_ENCRYPTION_KEY` to the same value on server and fleet-sync within each environment, and preserve it across redeploys and rollbacks. Configure `FLEET_SYNC_RUN_SECRET`, the database URL and public URLs in Dokploy. Node images do not apply `.env.schema` defaults. MySQL sessions must use UTC because Drizzle encodes and decodes `timestamp` values as UTC.

Local `pnpm dev` still runs `alchemy dev` with the `cloudflare-franz` profile. Use your own development MySQL through `packages/db/.env`; local cron ticks are not simulated, so trigger `/run` manually.

After release, verify sign-in and organization access, connect a provider with fleet read permissions, and inspect one authenticated manual run and a subsequent cron run in Dokploy's service logs. Check fresh UTC positions, a trip ETA, acknowledgement persistence, hazard resolution, and arrival completion. The [fleet-sync README](../apps/fleet-sync/README.md) covers manual runs, retention, query costs, and scaling limits. Roll back application code through Dokploy if verification fails; assess schema compatibility before rolling back a migrated service.
