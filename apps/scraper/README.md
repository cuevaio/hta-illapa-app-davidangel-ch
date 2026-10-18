# scraper

Cloudflare Worker on Cron Triggers that polls public Peruvian road and emergency feeds and keeps a normalized copy in MySQL (`hack_the_andes_incident`, `hack_the_andes_poi`, `hack_the_andes_scrape_run`). It exists so the API can answer "what is happening on or near this route right now" without hitting upstream services on every request.

## Schedules

| Cron | Sources |
| --- | --- |
| `*/5 * * * *` (`frequent`) | SUTRAN road alerts, INDECI COEN emergencies (24h + 2 days), Bomberos Perú last-24h emergencies, SENAMHI rain / quebrada / hydrological warnings, IGP last earthquake, SERFOR wildfire alerts |
| `0 * * * *` (`hourly`) | RPP latest news (classified by Jev), MTC SRATMA road accidents from the last 30 days, plus the road segment risk assessment (`POST /risk`, its own invocation) |
| `0 9 * * *` (`daily`) | SUTRAN alternative routes (with CDN geometry), fire stations, police stations, health facilities, bus terminals, weighing stations; INDECI national relief warehouses |

Both expressions live in `packages/infra/constants.ts` and are attached in `packages/infra/scraper.ts`.

## How a run works

1. Every source returns the full snapshot it currently knows (`IncidentSource` / `PoiSource` in `src/sources/types.ts`).
2. `src/sync.ts` loads the existing rows for that source, hashes each record and inserts new rows, updates changed ones (`lastChangedAt` moves), bumps `lastSeenAt` on unchanged ones and flips `active = false` on rows the source stopped reporting. A failed fetch never deactivates anything.
3. One `scrape_run` row per source per run records counts and the error message, and the invocation emits a single evlog wide event with a `sources[]` entry per feed.

Consumers that want near real-time alerts can poll `incident` for `active = true AND lastChangedAt > :lastCheck`.

Sources declare a `snapshot` mode. `full` sources report everything they know, so rows they stop reporting get deactivated. `partial` sources (news) only return new items, found by diffing the listing against `knownSourceIds` from the context, and never deactivate anything.

## News classification (Jev)

`rpp_latest_news` reads RPP's RSS feed (https://rpp.pe/rss, the latest 60 articles), fetches each new article once for its meta description, breadcrumb section and author, and asks TypeSafe's Jev model (through `@ai-sdk/typesafe-ai` + `experimental_decide` from the AI SDK) twelve typed questions in one request: relevance to intercity road transport, in Peru, current, mentions a road, road blocked, is a protest, people affected, category, severity rubric, time horizon, scope and region. Every article lands in `news_article` with the full answers and confidences in `classification`; an article is `relevant` when P(relevante) ≥ 0.6, P(enPeru) ≥ 0.5 and the category is not `no_aplica`, and relevant ones are mirrored into `incident` under the same source. Thresholds live in `src/constants.ts`, questions in `src/lib/jev.ts`. The key is `JEV_API_KEY` in `apps/scraper/.env`.

## Road accidents (SRATMA)

`sratma_accidents` reads the MTC accident viewer's internal API (`https://sratma.mtc.gob.pe/wssratma/api/Mapa/`): one `listarAccidenteMapa` call with the viewer's default filters (every reporting entity, last 30 days), then `listarAccidenteMapaInformacion` per accident for date, class, address, coordinates, counts and narrative. Concessionaires and police stations upload reports days after the fact, so most rows are map context with severity `info`. An accident that happened within the last 12 hours (`SRATMA_ROUTE_IMPACT_WINDOW_MS`) is sent to Jev, which picks the current `roadStatus` (`interrumpido`, `restringido`, `normal`) from the class, narrative, counts and hours elapsed; severity follows the same mapping as SUTRAN alerts. If Jev fails the accident stays `warning` and Jev is retried on the next run. Once it leaves the window it drops to `info`, and fleet alerts on it get resolved. The wide event reports `newAccidentLagHours` to keep an eye on the reporting delay.

Photos come from `DescargaArchivo` (a base64 JSON string; about half the accidents answer 404) and are stored once in the public Backblaze B2 bucket `illapa-media` under `sratma/accidents/{id}.{jpg|png}`, exposed as `incident.imageUrl`. Each run lists that prefix to know which photos are already stored, so only accidents without a photo hit `DescargaArchivo` again. A bucket lifecycle rule hides objects under `sratma/` 45 days after upload. The scraper uses a key scoped to that bucket (`B2_MEDIA_KEY_ID`, `B2_MEDIA_APPLICATION_KEY` in `apps/scraper/.env`).

An empty listing makes the run fail instead of deactivating every accident: the API answers an incomplete filter object with an empty 200.

## Adding a source

Implement `IncidentSource` or `PoiSource` and append it to `SOURCES` in `src/sources/index.ts`. The source only has to fetch and map; identity, hashing, activation and run bookkeeping are handled by the sync layer. Keep `sourceId` stable across runs (upstream id, report number, `layer:OBJECTID`...).

An Apify actor fits the same shape:

```ts
export const apifyRoadBlocksSource: IncidentSource = {
	kind: "incident",
	id: "apify_road_blocks",
	schedule: "frequent",
	async fetch() {
		const items = await fetchJson(
			`https://api.apify.com/v2/acts/${ACTOR_ID}/runs/last/dataset/items?token=${ENV.APIFY_TOKEN}`,
		);
		return itemsSchema.parse(items).map(toIncidentRecord);
	},
};
```

Add the token the usual way (`.env.schema`, `.env`, and the `env` map in `packages/infra/scraper.ts`).

## Running locally

`pnpm dev` starts the Worker on :3002 through `alchemy dev`. Cron fires are not simulated, so trigger runs by hand:

```sh
curl -X POST -H "x-scraper-secret: $SCRAPER_RUN_SECRET" 'http://localhost:3002/run?schedule=frequent'
curl -X POST -H "x-scraper-secret: $SCRAPER_RUN_SECRET" 'http://localhost:3002/run?source=sutran_alerts'
curl -X POST -H "x-scraper-secret: $SCRAPER_RUN_SECRET" 'http://localhost:3002/risk'
```

`/risk` needs the road segments loaded by `tools/risk-pipeline`. It returns the segment, weather-cell and assessment counts. Open-Meteo bills each weather cell as one call against 600 calls per minute, so two runs back to back can hit a 429. The client retries once after a minute.

The response is the same summary that goes to the wide event. `pnpm --filter scraper test` runs the parser and sync unit tests.

## Upstream notes

All feeds are undocumented public endpoints observed on 17 Oct 2026; none promise stability, CORS or rate limits. SENAMHI polygons are requested simplified (`maxAllowableOffset`) because the raw layer is several megabytes per request. Bomberos is server-rendered HTML: the parser reads the desktop table only and throws (instead of returning an empty list) when the page is a block/reCAPTCHA page.
