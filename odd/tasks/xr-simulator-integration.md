# xr-simulator integration

Objective: bring the xr-simulator WebXR viewer, huayco simulator and weather/tiles backend into illapa-app, with the xr-simulator viewer hosting the existing structures (bridge) simulator, gated to the `engineer` role.
Branch: `develop` (user request). Delivery: work-unit commits on `develop`; push/PR left to the user. Tests: vitest (`pnpm test`), `pnpm check-types`, `pnpm format:write`; pytest for the Python services.

## Specs

- **S1** Integrate `/Users/owex/Developer/phoenix/xr-simulator` (source commit `46ae0ab`, branch `feat/huaico-poc`): "este proyecto contiene el cliente para webxr y el simulador de huaycos, además integra nuevos datos metereológicos y de raster de tiles en su backend".
- **S2** The weather and raster-tile backend "deberan integrarse con el backend del proyecto de esta carpeta para no alterar los flujos que ya tiene el visor 3d webxr". Assumption: the Python services (GDAL/ecCodes, background pollers) run as separate containers and `apps/server` exposes them through authenticated proxy routes; existing viewers (route-review three.js 3D, `apps/illapa-quest`, `/ingenieria` editor) keep working unchanged until replaced in S3.
- **S3** "el visor del proyecto xr-simulator es el que tiene prioridad, así que acopla el simulador de estrucuturas actual al visor de xr-simulator".
- **S4** "solo el rol de civil/servidor publico puede acceder a ambos simuladores (de huayco y de puentes)". Decision (user, L3): that role is the existing `engineer`. Enforced on web routes and server-side (procedures and proxy routes).

- **S5** (L11) Structures can be opened from the VR map card too, not only from the screen, with an in-headset way back to the Peru map.
- **S6** (L11) The header and sidebar label for the engineering area names both simulators instead of "Estructuras". Assumption: "Simuladores" (es) / "Simulators" (en).

- **S7** (L14) "me tiene que aparecer el mapa desde el inicio, el mapa completo visto desde arriba como estaba en /Users/owex/Developer/phoenix/peru-simulator" and "quita lo de la inclinación del mapa". Assumption: the Peru overview opens straight top-down (no tilt), framing all of Peru in the viewport (portrait and landscape); users can still orbit afterwards.
- **S8** (L14) "que todas las opciones de mostrar nubes, vientos y demás aparezcan dentro del menu en la experiencia VR": every weather layer/option the web weather panel offers is also available from the VR menu.

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S1 | inline | done | aca68ce |
| T2 | S1, S2 | inline | done | 7103dbd |
| T3 | S4 | inline | merged into T4 | 170d38e |
| T4 | S2, S4 | inline | done (env files pending, user) | 170d38e |
| T5 | S3 | delegated (context backstop) | done | 60b4f8a, 7c6ec9a, 179c0bb |
| T6 | S3 | delegated (context backstop) | done | 377289c, a8a00c2 |
| T7 | S1, S3, S4 | delegated (context backstop) | done | a8a00c2, 92e360c |
| T8 | S1, S2 | inline | partial (deploy docs) | 540d335 |
| T9 | S5 | delegated (same writer) | done | ff5e3e3, 6b5bedf |
| T10 | S6 | delegated (same writer) | done | b416331, 5d4cf68 |
| T11 | S7 | delegated (same writer) | pending | |
| T12 | S8 | delegated (same writer) | pending | |

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
- **L5** T1: vitest 318/318 in packages/xr-simulator (lod.test.ts "refines towards the camera" is flaky, also fails intermittently at source 46ae0ab). Dropped: three.js feasibility page, validation export tool and 13 MB validation DEMs.
- **L6** T2: pytest tiles 70 passed/2 skipped (test_resilience circuit test flaky, passes on rerun and at source), weather 116 passed/2 skipped.
- **L7** T3 merged into T4: no oRPC procedure needs the role yet (structures are fixture-backed), so an `engineerProcedure` would be unused code. Role rule lives in `packages/business/src/simulators.ts` (`canUseSimulators`). T4: proxy tests 5/5, api suite 70/70. `.env*` edits are blocked by permissions: user must add `TILES_API_URL`/`WEATHER_API_URL` to `apps/server/.env.schema` and production URLs to `.env.production`.
- **L8** (2026-10-18, user): prod servers "estarán en dokploy" → no `.env.production` change; server gets `TILES_API_URL`/`WEATHER_API_URL` in Dokploy (internal hostnames). Documented in `deploy/README.md` (540d335). `.env.schema` entries added by the user, committed a6c073c.
- **L9** T5-T7 (writer): `XrViewer` shell + `SimulatorMode` seam; huayco → `modes/huayco/HuaycoMode.ts`; structures → `packages/ui/.../structure-scene-babylon/mode.ts` on `SiteTerrain` (z11 grid, z-mirror node converts left-handed grid to right-handed +x east/-z north); structure XR joins the viewer's shared session; `/ingenieria` hosts both via `xr-viewer.tsx`; guards use `canUseSimulators`. Removed `BabylonStructureScene` and `packages/terrain`. Not checked in a browser or on a Quest.
- **L10** Parent fixes: biome was not clean after T1 (condensed output hid 331 errors; my T1 claim was wrong) → fb4b730, 83381a0, 9e35fdf; LOD test timeout (O(n²) expects under parallel load) → 5858cc6, 337/337 x3; CORS exposes `X-Tile-*` → 01aa380. Suites: xr-simulator 337/337, ui 50/50, web 27/27, api 70/70, tiles pytest 71 passed, check-types ok.
- Open questions (writer): structures entry from the VR map card; header label still "Estructuras" (`m.engineering_title`).
- **L11** (2026-10-18, user): "si, si" — answering "¿Lo agregamos?" (structures from the VR map card) and "¿Le cambiamos el nombre?" (header/sidebar still "Estructuras").
- **L12** Independent verifier (c23ca58..0ad9d40): S1-S4 met, no blockers; 144-case proxy probe (fleet/no-role never reach upstream). Advisories acted on: proxy allowlist (3229300, 554e289); structures route after mount (6b5bedf).
- **L13** T9: VR map card lists other simulators; structures uses its table maquette in immersive-vr (placed in front, opaque background) with "Volver al mapa del Perú" inside the headset. T10: area label "Simuladores"/"Simulators"; structures list keeps "Estructuras". Spot check at 554e289: check-types 0 errors, xr-simulator 340/340, ui 53/53, web 27/27, api 74/74; biome clean for tracked files.
- **L14** (2026-10-18, user): "me tiene que aparecer el mapa desde el inicio, el mapa completo visto desde arriba como estaba en /Users/owex/Developer/phoenix/peru-simulator" / "quita lo de la inclinación del mapa. Luego que todas las opciones de mostrar nubes, vientos y demás aparezcan dentro del menu en la experiencia VR". Staging deployed (tiles/weather apps healthy, server env set). Current overview camera: alpha -π/2, beta 0.7, radius 3400 (`PeruOverview.ts:277`); peru-simulator: ~35° tilt at ~1580 km.
- Pending: manual browser + Quest check (map, huayco, structures editing, tiles/weather through the proxy, VR map ↔ structures handover). Push/PR: user decision.
