# hack-the-andes-project

pnpm monorepo: Hono + oRPC API on Cloudflare Workers (`apps/server`), Vite SPA (`apps/web`), Expo app (`apps/native`), cron scraper Worker for road/emergency feeds (`apps/scraper`, see its README), better-auth, Drizzle + MySQL through Hyperdrive, evlog wide-event logging, deployed with Alchemy v2 (local state in `packages/infra/.alchemy/`).

## Product docs

[Project brief](docs/project_brief.md) · [MVP PRD](docs/prd.md) · [Design system](docs/DESIGN.md)

## Setup

1. `pnpm install` (generates the typed env files from every `.env.schema`).
2. Secrets (gitignored):
   - `apps/server/.env` → `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), and optionally `DEMO_RESET_SECRET` to enable the demo reset
   - `packages/db/.env` → `DATABASE_URL=mysql://…@vero:3306/fierros` (vero over Tailscale)
   - `apps/scraper/.env` → `SCRAPER_RUN_SECRET` (`openssl rand -base64 32`), `JEV_API_KEY`, and `B2_MEDIA_KEY_ID` / `B2_MEDIA_APPLICATION_KEY` (B2 key scoped to the `illapa-media` bucket)
3. `pnpm infra:login` once to connect the `cloudflare-franz` Alchemy profile (`pnpm infra:refresh` when the token expires).
4. `pnpm db:migrate` to create the `hack_the_andes_*` tables.

Public URLs live in tracked files: `.env.schema` defaults are the localhost values and `.env.production` overrides them on deploy (`APP_ENV=production`).

## Database changes

Schema changes ship as versioned migrations in `packages/db/src/migrations`, one folder per change, applied in name order and recorded in the `__hack_the_andes_migrations` table.

1. Change the tables in `packages/db/src/schema`.
2. `pnpm db:generate --name <change>` writes the migration. Commit it with the schema change; never edit it by hand.
3. `pnpm db:migrate` applies it to your local database.
4. After rebasing onto a branch that brought its own migrations, run `pnpm db:generate` again. It stops with "Non-commutative migrations detected" when two branches changed the same thing; drop your migration, regenerate it on top, and commit that.

On Dokploy the server applies pending migrations before it starts listening, so staging migrates when `develop` deploys and production when `main` does. A local database created with `db:push` before migrations existed has no history: drop it and run `pnpm db:migrate`. Keep `db:push` for throwaway databases.

## Production domains and deployment

Illapa's dashboard is served at `https://dash.illapa.app` and its API at `https://api.illapa.app`. Alchemy attaches both as Worker custom domains using the hostnames in `packages/infra/constants.ts`. The existing `workers.dev` URLs remain enabled, and the old web origin stays trusted during cutover. Better Auth uses the API domain in production and `http://localhost:3000` locally.

Before deploying, authenticate the `cloudflare-franz` profile and provide the gitignored secrets listed in Setup, preserving the existing `BETTER_AUTH_SECRET`. The `illapa.app` zone must be active in that account. Resolve any conflicting CNAME records or attachments to another Worker for `dash` and `api`; no manual DNS records are otherwise needed, because [Cloudflare custom domains provision DNS and TLS](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

For the first cutover, run `pnpm deploy:server`, wait until `https://api.illapa.app/api/auth/ok` responds successfully over HTTPS, then run `pnpm deploy:web`. These commands deploy each Worker independently. `pnpm deploy` deploys the full stack (server, web, and scraper) concurrently; use it for subsequent full releases.

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | `alchemy dev`: server on :3000, web on :3001, scraper on :3002, Hyperdrive pointed at `DATABASE_URL` |
| `pnpm dev:native` | Expo dev server |
| `pnpm build` / `pnpm check-types` / `pnpm test` | Build, type-check and test every package |
| `pnpm deploy` | Deploy server + web + scraper to the `prod` stage |
| `pnpm deploy:server` / `pnpm deploy:web` / `pnpm deploy:scraper` | Deploy a single Worker |
| `pnpm deploy:plan` | Preview the deploy without applying it |
| `pnpm logs:server` / `pnpm logs:web` / `pnpm logs:scraper` | Tail Workers Logs (evlog events + CPU time) |
| `pnpm build:native:android` / `:ios` | Local EAS build (preview profile) |
| `pnpm build:native:cloud:android` / `:ios` | Remote EAS build (preview profile) |
| `pnpm build:native:prod:android` / `:ios` | Remote EAS production build |
| `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio` | drizzle-kit against `DATABASE_URL` (see Database changes) |
| `pnpm demo:reset` | Wipe and reseed the shared demo account (see Demo access) |

## Auth

Every server route requires a session except `/`, `/api/auth/*`, public `POST /api/demo-requests`, the secret-guarded `/api/demo/reset` and the procedures listed in `PUBLIC_PROCEDURE_PATHS`. Browser origins allowed for CORS and better-auth come from the comma-separated `ALLOWED_ORIGINS`.

## Demo access

"Probar demo" on illapa.app opens `dash.illapa.app/demo`, which signs the visitor into the shared `demo@illapa.app` account through `/api/auth/demo/sign-in` (no password, 30 sign-ins per minute per IP) and seeds its demo fleet and two demo trips on first use. A visitor already signed in with their own account is asked before the demo replaces it: they can keep that account or sign out and open the demo. The endpoint itself refuses (409) to replace a real account's session. Once every trip of the demo account is completed or cancelled, the next fleet-sync run or `/demo` visit restarts the demo with the same wipe and reseed as the reset below. The demo account cannot change its email, password, sessions or organization, and can only add demo GPS connections.

The reset endpoint is off unless the server has `DEMO_RESET_SECRET` set (add it before deploying when you need it). To restart it on demand, for example while a trip is still running, use `DEMO_RESET_SECRET=… DEMO_RESET_URL=https://api.illapa.app/api/demo/reset pnpm demo:reset`. Without `DEMO_RESET_URL` it targets the local server. It deletes the demo organization's alerts, trips, vehicles and connections and seeds them again.

## Dashboard and fleet tracking

The dashboard at `dash.illapa.app` combines incident feeds with organization-scoped Geotab and Samsara vehicles, trips, ETAs, and hazard alerts. The fleet-sync Worker polls GPS providers every two minutes; shared rules live in `packages/business`.

See the [dashboard plan and operations notes](docs/dashboard-plan.md), [fleet-sync runbook](apps/fleet-sync/README.md), and [business module map](packages/business/README.md).

## Predictive risk engine

Illapa scores road segments for the risk of rain-triggered hazards (huaicos, landslides, floods) and compares routes by exposure. The pilot is the Carretera Central, Lima–Huancayo (PE-22).

- **Offline pipeline** ([`tools/risk-pipeline`](tools/risk-pipeline/README.md), Python):
  - It builds the road graph from the Geofabrik OpenStreetMap extract and cuts it into segments of about 1 km.
  - It adds static features to each segment: Copernicus DEM slope, INGEMMET mass-movement and fluvial-flood susceptibility, and distance to rivers.
  - It loads everything into the `hack_the_andes_road_*` tables.
- **Hourly scoring:** the scraper's hourly cron calls `POST /risk`. It combines Open-Meteo rain (last 72 h plus the 24/48/72 h forecast), nearby historical landslides and floods, and active SENAMHI, INDECI and SUTRAN alerts into a 0–100 score per segment and horizon (`hack_the_andes_segment_risk_assessment`).
- **API:**
  - `risk.segments` lists segments with their latest assessment.
  - `risk.compareRoutes` runs A* over the graph twice: once for the fastest route and once with a risk penalty. SUTRAN `interrumpido` closures are hard constraints, and when no route exists it returns the official SUTRAN detours.
- **Optional model:** `train.py` trains a LightGBM model on INDECI COEN events and exports it to the Worker only if it beats the heuristic on every held-out route. The last run did not (28 positive segment-days), so the heuristic is active.

Scores are relative indices that support decisions, not calibrated probabilities. Every response carries a disclaimer and the assessment timestamps. When the weather fetch fails, the previous assessment is kept rather than scored as dry.

To load the pipeline locally: `pnpm db:migrate`, then `uv run python -m illapa_risk.build` and `uv run python -m illapa_risk.load` in `tools/risk-pipeline`. After that, trigger a scoring run with `POST http://localhost:3002/risk` (header `x-scraper-secret`).
