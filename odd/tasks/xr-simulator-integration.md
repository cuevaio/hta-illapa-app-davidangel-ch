# xr-simulator integration

Objective: bring the xr-simulator WebXR viewer, huayco simulator and weather/tiles backend into illapa-app, with the xr-simulator viewer hosting the existing structures (bridge) simulator, gated to the `engineer` role.
Branch: `develop` (user request). Delivery: work-unit commits on `develop`; push/PR left to the user. Tests: vitest (`pnpm test`), `pnpm check-types`, `pnpm format:write`; pytest for the Python services.

## Specs

- **S1** Integrate `/Users/owex/Developer/phoenix/xr-simulator` (source commit `46ae0ab`, branch `feat/huaico-poc`): "este proyecto contiene el cliente para webxr y el simulador de huaycos, además integra nuevos datos metereológicos y de raster de tiles en su backend".
- **S2** The weather and raster-tile backend "deberan integrarse con el backend del proyecto de esta carpeta para no alterar los flujos que ya tiene el visor 3d webxr". Assumption: the Python services (GDAL/ecCodes, background pollers) run as separate containers and `apps/server` exposes them through authenticated proxy routes; existing viewers (route-review three.js 3D, `apps/illapa-quest`, `/ingenieria` editor) keep working unchanged until replaced in S3.
- **S3** "el visor del proyecto xr-simulator es el que tiene prioridad, así que acopla el simulador de estrucuturas actual al visor de xr-simulator".
- **S4** "solo el rol de civil/servidor publico puede acceder a ambos simuladores (de huayco y de puentes)". Decision (user, L3): that role is the existing `engineer`. Enforced on web routes and server-side (procedures and proxy routes).

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S1 | inline | pending | |
| T2 | S1, S2 | inline | pending | |
| T3 | S4 | inline | pending | |
| T4 | S2, S4 | inline | pending | |
| T5 | S3 | inline | pending | |
| T6 | S3 | inline | pending | |
| T7 | S1, S3, S4 | inline | pending | |
| T8 | S1, S2 | inline | pending | |

- T1: import the xr-simulator client as workspace package `packages/xr-simulator` (+ `packages/tiles-schema`), on the pnpm catalog Babylon version; drop the three.js feasibility page; its vitest suite passes.
- T2: import the Python services under `services/tiles` and `services/weather` with Dockerfiles, compose and pytest; no `.venv`, caches or validation DEMs.
- T3: server-side role middleware (`engineerProcedure`) in `packages/api`.
- T4: `apps/server` proxy routes for tiles and weather, engineer-only, upstream URLs as server env (`.env.schema`, `.env`/`.env.production`, alchemy env map).
- T5: split xr-simulator `App` into a shared viewer shell (Peru map, shared XR session, weather, tiles) and simulator modes; huayco becomes one mode with unchanged behavior.
- T6: structures simulator as a second mode of the xr-simulator viewer, reusing `structure-scene-babylon` runtime, structures business logic and the structure client.
- T7: engineer-only web route that mounts the xr-simulator viewer (React wrapper with cleanup), pointing tiles/weather at the server proxy; `/ingenieria` navigates to it.
- T8: docs (README, deploy/Dokploy for the two services, env vars).

Routes are inline: no Writer trigger (units depend on each other sequentially). High-risk items: T3/T4 (auth guards, item 2), T2/T8 (deploy, item 5) → independent verifier at feature end.

## Log

- **L1** (2026-10-18, user): "ahora necsito que integres el proyecto /Users/owex/Developer/phoenix/xr-simulator , este proyecto contiene el cliente para webxr y el simulador de huaycos, además integra nuevos datos metereológicos y de raster de tiles en su backend. Dichos sistemas deberan integrarse con el backend del proyecto de esta carpeta para no alterar los flujos que ya tiene el visor 3d webxr, sin embargo, recuerda que el visor del proyecto xr-simulator es el que tiene prioridad, así que acopla el simulador de estrucuturas actual al visor de xr-simulator. Recuerda que solo el rol de civil/servidor publico puede acceder a ambos simuladores (de huayco y de puentes)"
- **L2** (2026-10-18, user): "hazlo en develop" — switched to `develop` tracking `origin/develop` (61 commits ahead of `main`).
- **L3** (2026-10-18, user): role = existing `engineer` ("Usar `engineer`").
- **L4** Exploration: both viewers are Babylon 9; xr-simulator backend is Python FastAPI (tiles: rasterio/GDAL; weather: eccodes/h5py + pollers), cannot run in a Worker. illapa `packages/terrain` was ported from the same terrain LOD lineage. Server has no role middleware today; gating is web-only (`apps/web/src/routes/_auth/ingenieria/route.tsx:27`). Structures data is fixture/localStorage only.
- Next: T1.
