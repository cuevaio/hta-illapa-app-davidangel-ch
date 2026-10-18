# Dokploy deployment

## Static sites

Build with the repository root as the context. Both images serve static files through nginx on port `80`. Dokploy runs one app per environment for each site; build a separate image with that environment's public URLs.

| Site | Dockerfile | Build args |
| --- | --- | --- |
| Dashboard (`web`) | `deploy/web.Dockerfile` | `VITE_SERVER_URL` |
| Marketing (`illapa`) | `deploy/illapa.Dockerfile` | `PUBLIC_APP_URL` (dashboard origin), `PUBLIC_API_URL` (API origin) |

The URLs are baked in at build time. Empty or omitted build args use the site's `.env.production` values. The marketing form posts to `${PUBLIC_API_URL}/api/demo-requests` on the API server; include the marketing origin in that server's `ALLOWED_ORIGINS`.

## Node services

`server`, `scraper` and `fleet-sync` are Cloudflare Workers that Alchemy deploys from `packages/infra`. The same code also runs as a plain Node 24 process. Each app gets its own Docker image, built from `deploy/node-service.Dockerfile`, and Dokploy serves it behind Traefik. The Workers build and deploy are unchanged.

## How the Node build works

- `apps/<app>/src/node.ts` serves the Worker's default export through `@hack-the-andes-project/node-runtime`, using `@hono/node-server` for HTTP and `croner` for the cron triggers.
- `apps/<app>/tsdown.node.config.ts` bundles the app and all of its dependencies into `dist-node/`. The bundle swaps three Workers-only modules for Node versions (`packages/node-runtime/src/bundle-aliases.ts`):
  - `cloudflare:workers`: `env` is `process.env`. `HYPERDRIVE` is parsed from `DATABASE_URL`. The scraper's `SELF` binding calls back into the same process on `127.0.0.1:$PORT`.
  - `evlog/workers`: one JSON line per event on stdout.
  - `createDb`: closes the per-request MySQL connection when its request or cron run finishes. workerd does this on its own; Node does not.
- The server bundle also copies `packages/db/src/migrations` into `dist-node/migrations`, and the server applies the pending ones before it listens. A failed migration stops the boot, so the deploy fails instead of serving the new code against the old schema. scraper and fleet-sync never migrate.
- The image does not run varlock, so `.env.schema` defaults do not apply. Set every variable below. Only `DATABASE_URL` is checked at boot; any other missing variable fails the first request that needs it.

## Build and run

| | |
| --- | --- |
| Dockerfile | `deploy/node-service.Dockerfile`, with the repository root as build context |
| Build arg | `APP=server`, `APP=scraper` or `APP=fleet-sync` |
| Start command | the image `CMD`, `node node.mjs` in `/app` |
| Port | `3000`, set as `PORT` and exposed by the image |
| Health check | `GET /` answers `OK` |

```sh
docker build -f deploy/node-service.Dockerfile --build-arg APP=server -t illapa-server .
```

To run without Docker, use `pnpm --filter <app> build:node`, then `pnpm --filter <app> start:node` with the variables below exported. `PORT` defaults to 3000.

## Environment

Use the same values as the Workers (`apps/<app>/.env`, `apps/server/.env.production`). `DATABASE_URL` replaces the Hyperdrive binding: `mysql://user:password@host:3306/fierros`, with any special characters in the user or password percent-encoded. `SERVICE_VERSION` is optional. When set (to the commit, for example), it is the build identity on every log event.

### server

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes | see above |
| `APP_ENV` | yes | `production` |
| `BETTER_AUTH_URL` | yes | public URL of this service, e.g. `https://api.illapa.app` |
| `BETTER_AUTH_SECRET` | yes | at least 32 characters |
| `ALLOWED_ORIGINS` | yes | comma-separated browser origins; `*` matches inside one host label |
| `CREDENTIALS_ENCRYPTION_KEY` | yes | the same key as fleet-sync and the Workers |
| `OSRM_BASE_URL` | yes | `https://router.project-osrm.org` |
| `CLIENT_IP_HEADER` | yes | `x-real-ip` behind Traefik (the Workers keep the default `cf-connecting-ip`) |
| `TILES_API_URL` | yes | origin of the tiles backend (`services/tiles`), proxied to engineers under `/tiles-api/*` (only `/tiles/*`, `/capas`, `/salud`) |
| `WEATHER_API_URL` | yes | origin of the weather backend (`services/weather`), proxied to engineers under `/weather-api/*` (only `/api/*`) |
| `DEMO_RESET_SECRET` | no | at least 32 characters; leave it unset to keep `POST /api/demo/reset` off |
| `SERVICE_VERSION` | no | |

### scraper

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes | see above |
| `APP_ENV` | yes | `production` |
| `SCRAPER_RUN_SECRET` | yes | at least 32 characters; the `x-scraper-secret` header of `POST /run` and `POST /risk` |
| `JEV_API_KEY` | yes | TypeSafe (Jev) key that classifies the news |
| `B2_MEDIA_KEY_ID` | yes | Backblaze B2 key for the `illapa-media` bucket |
| `B2_MEDIA_APPLICATION_KEY` | yes | Backblaze B2 key for the `illapa-media` bucket |
| `SRATMA_RELAY_URL` | on AWS | origin of the SRATMA relay below; empty means calling SRATMA directly |
| `SERVICE_VERSION` | no | |

Crons, in UTC: `*/5 * * * *`, `0 * * * *` and `0 9 * * *` (from `packages/infra/constants.ts`).

#### SRATMA relay

SRATMA (`sratma.mtc.gob.pe`) drops connections from AWS but answers Cloudflare, so on Dokploy the scraper reaches it through `deploy/sratma-relay/worker.js`, a Cloudflare Worker with no dependencies. It relays only GETs under `/wssratma/api/Mapa/`, and only for the client IPs in its `ALLOWED_CLIENT_IPS` plain-text variable (the Dokploy box's Elastic IP). Set the scraper's `SRATMA_RELAY_URL` to the Worker's origin, e.g. `https://illapa-sratma-relay.<subdomain>.workers.dev`.

### fleet-sync

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes | see above |
| `APP_ENV` | yes | `production` |
| `FLEET_SYNC_RUN_SECRET` | yes | at least 32 characters; the `x-fleet-sync-secret` header of `POST /run` |
| `CREDENTIALS_ENCRYPTION_KEY` | yes | 44-character base64 key, the same one as the server |
| `OSRM_BASE_URL` | yes | `https://router.project-osrm.org` |
| `SERVICE_VERSION` | no | |

Cron, in UTC: `*/2 * * * *`.

## Simulator backends

`services/tiles` (Peru terrain tiles) and `services/weather` (NOAA GFS, GLM lightning and GOES-19 clouds) are Python services that only the server calls, through its engineer-only `/tiles-api/*` and `/weather-api/*` routes. They have no authentication of their own, so do not give them a public domain. Run each one as a Dokploy app on the same network as the server, and point the server at their internal hostnames.

| | tiles | weather |
| --- | --- | --- |
| Dockerfile | `services/tiles/Dockerfile` | `services/weather/Dockerfile` |
| Build context | repository root | repository root |
| Port | `8080` | `8787` |
| Health check | `GET /salud` | `GET /api/health` |
| Volume | none with S3 storage | `/data/cache` (GFS, GLM and cloud cache) |
| Server variable | `TILES_API_URL=http://<tiles app name>:8080` | `WEATHER_API_URL=http://<weather app name>:8787` |

- tiles: set `TILES_STORAGE=s3` with `TILES_S3_ENDPOINT`, `TILES_S3_BUCKET`, `TILES_S3_ACCESS_KEY`, `TILES_S3_SECRET_KEY` (R2 or S3), and `TILES_CONTACT`. With `TILES_STORAGE=fs`, mount a volume at `TILES_FS_ROOT` that user `10001` can write to. All variables are listed in `services/tiles/README.md`.
- weather: the defaults cover Peru. Run exactly one replica, because its pollers write to the cache volume. Variables are listed in `services/weather/README.md`.
- `services/docker-compose.yml` runs both services with MinIO locally (`docker compose -f services/docker-compose.yml up -d --build`). The server's local defaults already point at them.

## Operations

- Every instance runs the crons. Run exactly one replica of scraper and of fleet-sync. Keep their Cloudflare cron Workers off while the Node services use the same database.
- If a cron tick arrives while the previous run of that cron is still busy, it is skipped and logged as a `cron_skipped` warning. Runs never overlap and missed ticks are not caught up.
- On SIGTERM a service stops its crons and stops accepting requests. It then waits up to 8 s for in-flight requests, cron runs and `waitUntil` work before it exits. Docker's default 10 s stop grace period covers that.
- `x-real-ip` holds the TCP peer that Traefik sees. If Cloudflare proxies in front of Traefik, set `CLIENT_IP_HEADER=cf-connecting-ip` and only accept origin traffic from Cloudflare. Otherwise a client that reaches Traefik directly could spoof that header.
- Node keeps idle keep-alive connections open for 95 s, longer than Traefik's 90 s idle timeout. Traefik therefore never reuses a connection that Node has already closed.
