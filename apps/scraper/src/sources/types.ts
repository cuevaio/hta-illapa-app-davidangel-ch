import type {
	incident,
	newsArticle,
	poi,
} from "@hack-the-andes-project/db/schema/scraper";
import type { InferInsertModel } from "drizzle-orm";
import type { RequestLogger } from "evlog";

import type { MediaBucket } from "../lib/media-bucket";

export const SCHEDULES = ["frequent", "hourly", "daily"] as const;
export type Schedule = (typeof SCHEDULES)[number];

type ManagedColumns =
	| "id"
	| "source"
	| "contentHash"
	| "active"
	| "firstSeenAt"
	| "lastSeenAt"
	| "lastChangedAt";

export type IncidentRecord = Omit<
	InferInsertModel<typeof incident>,
	ManagedColumns
>;
export type PoiRecord = Omit<InferInsertModel<typeof poi>, ManagedColumns>;
export type NewsRecord = Omit<
	InferInsertModel<typeof newsArticle>,
	ManagedColumns
>;

// Credentialed clients built once per invocation from the Worker env.
export interface ScrapeServices {
	jevApiKey: string;
	mediaBucket: MediaBucket;
	// SRATMA drops connections from cloud providers such as AWS, so deploys
	// there reach it through deploy/sratma-relay instead of directly.
	sratmaApiBase: string;
}

export interface ScrapeContext extends ScrapeServices {
	now: Date;
	// sourceIds already stored for this source, so expensive per-item work
	// (article page fetches, model calls) only happens for new items.
	knownSourceIds: ReadonlySet<string>;
	log: RequestLogger;
}

// A "full" snapshot lists everything the source currently knows, so rows it
// no longer reports get deactivated. A "partial" snapshot only carries what
// the source chose to return (typically new items) and never deactivates.
export type SnapshotMode = "full" | "partial";

interface SourceBase {
	id: string;
	schedule: Schedule;
	snapshot: SnapshotMode;
}

// A source is anything that can produce a snapshot of what it currently
// knows: a public JSON API, a scraped HTML page, an ArcGIS layer or an Apify
// dataset. Identity, hashing, activation and run bookkeeping live in sync.ts.
export interface IncidentSource extends SourceBase {
	kind: "incident";
	fetch(context: ScrapeContext): Promise<IncidentRecord[]>;
}

export interface PoiSource extends SourceBase {
	kind: "poi";
	fetch(context: ScrapeContext): Promise<PoiRecord[]>;
}

export interface NewsSource extends SourceBase {
	kind: "news";
	fetch(context: ScrapeContext): Promise<NewsRecord[]>;
	toIncident(record: NewsRecord): IncidentRecord | null;
}

export type ScrapeSource = IncidentSource | PoiSource | NewsSource;
