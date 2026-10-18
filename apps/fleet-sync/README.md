# Fleet sync

Node 24 service on Dokploy, scheduled every two minutes (`*/2 * * * *`). Each full run:

1. Prunes up to 10,000 position-history rows older than 30 days.
2. Resolves alerts for ended trips and inactive incidents.
3. Polls each GPS connection, including connections in `error` status so transient failures recover. It imports vehicles, writes newer positions and updates the latest-position checkpoint.
4. Evaluates active trips against active alertable incidents. It updates ETAs, reroutes off-route vehicles, completes arrivals within 300 m of the requested destination, and creates or refreshes hazard alerts.
5. Reconciles obsolete alerts again.
6. Restarts the shared demo (`demo@illapa.app`) once every trip of its organization is completed or cancelled: it wipes the demo fleet and seeds it again, so the trucks leave their depots on fresh hazard and clear trips. Demo connections of other organizations are never touched.
7. Emits one evlog event with results, then closes its database connection.

Connections and trips run sequentially. A connection can make two provider requests concurrently. Alert writes use batches of 250. Alerts are unique per trip and incident; acknowledgement does not reopen on the next poll. Open and acknowledged alerts resolve once the hazard is passed or no longer active. Alternative-routing failures still save the hazard alert.

## Environment and secrets

Production (`main`) and staging (`develop`) each run one instance, built with `deploy/node-service.Dockerfile` and `APP=fleet-sync`. Set its env in Dokploy; Node images do not load `.env.schema` defaults. See [the deployment runbook](../../deploy/README.md).

- `DATABASE_URL`: MySQL 8.4 connection for `illapa` (production) or `illapa_staging` (staging). The Node runtime derives the database binding from it.
- `CREDENTIALS_ENCRYPTION_KEY`: base64 encoding of a 32-byte AES key, identical to the server's key in this environment.
- `FLEET_SYNC_RUN_SECRET`: at least 32 characters, required by the manual `/run` endpoint.
- `OSRM_BASE_URL`: routing endpoint; set it explicitly in Dokploy.
- `APP_ENV`: `production` for the deployed service. `SERVICE_VERSION` is an optional build identity.

Generate a new secret with `openssl rand -base64 32`. Preserve the existing encryption key across redeploys; replacing it makes stored credentials unreadable.

## Local development and manual runs

For local dev, put `FLEET_SYNC_RUN_SECRET` and the shared encryption key in `apps/fleet-sync/.env`, and the same encryption key in `apps/server/.env`. Set `packages/db/.env` (`DATABASE_URL`) to your own MySQL. From the root, run `pnpm install`, configure the `cloudflare-franz` profile with `pnpm infra:login`, then `pnpm dev`. This still uses Alchemy's local Workers runtime on port 3003; local cron ticks are not simulated. Local Hyperdrive connects to `DATABASE_URL`, so use a development database when testing writes. The generated `src/env.ts` is listed in `.gitignore`; runtime code imports `env.server.ts`.

With `FLEET_SYNC_RUN_SECRET` exported in your shell:

```sh
curl --fail-with-body -X POST \
  -H "x-fleet-sync-secret: $FLEET_SYNC_RUN_SECRET" \
  http://localhost:3003/run

curl --fail-with-body -X POST \
  -H "x-fleet-sync-secret: $FLEET_SYNC_RUN_SECRET" \
  'http://localhost:3003/run?connection=<connection-id>'
```

Use this environment's fleet-sync URL from Dokploy in place of localhost for a deployed run. `/run` requires POST and the header; a secret in the URL is not accepted. A connection-specific run polls and evaluates only that connection, skips global history pruning, and reconciles obsolete alerts in its organization. Unknown connections return 404; failed runs return 500 with safe per-item results. `/` is a public health check.

A demo connection (Configuración → Demo, or "Usar flota demo" on an empty Flota page) needs no GPS account. Each run moves its trucks along their active trip routes, ten times faster than the planned pace, so ETAs, hazard alerts and arrivals go through the real pipeline. In the trip planner, a demo truck can take a "Ruta demo" that passes an active incident or avoids all of them, to show an alert or a clean trip on purpose. Locally, trigger `/run` to advance the trucks.

Run `pnpm --filter fleet-sync test` and `pnpm --filter fleet-sync check-types`. Dokploy handles deployment and service logs; follow the [operations notes](../../docs/dashboard-plan.md#operations).

## Capacity

For a successful full run, budget eight fixed SQL statements (five reads, two alert reconciliations, one history cleanup). Each connection adds one status update and up to four statements per 250 vehicles. Each evaluated trip adds three statements plus one per 250 hazards; an arrival needs two. A run that includes the demo account's connection reads its trips once more; a demo restart then adds seven deletes and a fresh seeding of about 20 statements, with up to 18 OSRM requests. Count these MySQL statements separately from HTTP traffic when sizing a run.

Geotab normally needs four HTTP calls per connection (two Authenticate/Get pairs), up to eight with session retries. Samsara needs one call per page for each of vehicles and GPS stats, capped at 100 pages per collection. A trip makes at most one OSRM call per evaluation. External requests time out after 15 seconds.

The service still loads all connections, active trips and active incidents. It has no fleet-wide pagination or persistent work queue. Large fleets need partitioned runs before reaching memory, CPU or schedule capacity; sequential execution limits concurrent connections, not total work. Geotab Get results also have provider-side limits. Watch evlog run failures, resource usage, query counts, and `positionsPruned`; repeated full cleanup batches indicate a retention backlog.
