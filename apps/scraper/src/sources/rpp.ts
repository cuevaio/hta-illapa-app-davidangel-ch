import { z } from "zod";

import { RPP_FEED_URL, RPP_FETCH_CONCURRENCY } from "../constants";
import { mapWithConcurrency } from "../lib/concurrency";
import { parseIsoDate } from "../lib/dates";
import { decodeHtmlEntities } from "../lib/html";
import { fetchText } from "../lib/http";
import { classifyNews } from "../lib/jev";
import type {
	IncidentRecord,
	NewsRecord,
	NewsSource,
	ScrapeContext,
} from "./types";

const FEED_ITEM_PATTERN = /<item>([\s\S]*?)<\/item>/g;
const FEED_TITLE_PATTERN =
	/<title>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/title>/;
const FEED_LINK_PATTERN = /<link>([^<]+)<\/link>/;
const FEED_PUB_DATE_PATTERN = /<pubDate>([^<]+)<\/pubDate>/;
const ARTICLE_ID_PATTERN = /-noticia-(\d+)\/?$/;
const META_DESCRIPTION_PATTERN =
	/<meta[^>]+(?:name|property)="(?:og:)?description"[^>]*content="([^"]*)"/;
const META_AUTHOR_PATTERN = /<meta[^>]+name="author"[^>]*content="([^"]*)"/;
const JSON_LD_PATTERN =
	/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g;

const breadcrumbListSchema = z.object({
	"@type": z.literal("BreadcrumbList"),
	itemListElement: z.array(z.object({ name: z.string() })),
});

export interface RppFeedEntry {
	sourceId: string;
	url: string;
	title: string;
	publishedAt: Date | null;
}

export interface RppArticleDetails {
	excerpt: string | null;
	section: string | null;
	author: string | null;
}

// Live blogs (`…-live-3663`) have no `-noticia-<id>` to key them by and are
// retitled every day, so only articles are listed.
export function parseRppFeed(xml: string): RppFeedEntry[] {
	const entries: RppFeedEntry[] = [];
	for (const [, item] of xml.matchAll(FEED_ITEM_PATTERN)) {
		const url = item?.match(FEED_LINK_PATTERN)?.[1];
		const sourceId = url?.match(ARTICLE_ID_PATTERN)?.[1];
		const title = item?.match(FEED_TITLE_PATTERN)?.[1];
		if (!item || !url || !sourceId || !title) {
			continue;
		}
		entries.push({
			sourceId,
			url,
			title: decodeHtmlEntities(title).trim(),
			publishedAt: parseIsoDate(item.match(FEED_PUB_DATE_PATTERN)?.[1]),
		});
	}
	if (entries.length === 0) {
		throw new Error("RPP feed lists no articles");
	}
	return entries;
}

// The breadcrumb runs home › section › subsection › headline; the subsection
// ("Ica", "Policiales") is the section RPP's listing cards show. A missing or
// malformed breadcrumb only leaves the section empty.
function readBreadcrumbSection(articleHtml: string): string | null {
	for (const [, jsonLd] of articleHtml.matchAll(JSON_LD_PATTERN)) {
		if (!jsonLd?.includes('"BreadcrumbList"')) {
			continue;
		}
		try {
			const breadcrumbs = breadcrumbListSchema.parse(JSON.parse(jsonLd));
			return breadcrumbs.itemListElement.at(-2)?.name.trim() ?? null;
		} catch {
			return null;
		}
	}
	return null;
}

export function parseRppArticle(articleHtml: string): RppArticleDetails {
	const description = articleHtml.match(META_DESCRIPTION_PATTERN)?.[1];
	const excerpt = description ? decodeHtmlEntities(description).trim() : "";
	const author = articleHtml.match(META_AUTHOR_PATTERN)?.[1];
	return {
		excerpt: excerpt.length > 0 ? excerpt : null,
		section: readBreadcrumbSection(articleHtml),
		author: author ? decodeHtmlEntities(author).trim() : null,
	};
}

// Only articles not yet stored are expanded (one page fetch for the excerpt,
// section and author, one Jev call for the classification); a failure on
// either side drops the article from this run so it is retried on the next
// listing.
async function expandEntry(
	entry: RppFeedEntry,
	context: ScrapeContext,
): Promise<NewsRecord | null> {
	let article: RppArticleDetails;
	try {
		article = parseRppArticle(await fetchText(entry.url));
	} catch (error) {
		context.log.set({
			rpp: { articleFailures: [{ url: entry.url, error: String(error) }] },
		});
		return null;
	}
	try {
		const classification = await classifyNews(context.jevApiKey, {
			title: entry.title,
			excerpt: article.excerpt,
			section: article.section,
			publishedAt: entry.publishedAt,
		});
		return {
			sourceId: entry.sourceId,
			url: entry.url,
			title: entry.title,
			excerpt: article.excerpt,
			section: article.section,
			author: article.author,
			publishedAt: entry.publishedAt,
			relevant: classification.relevant,
			relevance: classification.relevance,
			category: classification.category,
			severity: classification.severity,
			region: classification.region,
			classification: {
				status: classification.status,
				answers: classification.answers,
				confidence: classification.confidence,
				model: classification.model,
			},
		};
	} catch (error) {
		context.log.set({
			rpp: {
				classificationFailures: [{ url: entry.url, error: String(error) }],
			},
		});
		return null;
	}
}

export const rppNewsSource: NewsSource = {
	kind: "news",
	id: "rpp_latest_news",
	schedule: "hourly",
	snapshot: "partial",
	async fetch(context) {
		const listing = parseRppFeed(await fetchText(RPP_FEED_URL));
		const fresh = listing.filter(
			(entry) => !context.knownSourceIds.has(entry.sourceId),
		);
		context.log.set({
			rpp: { listed: listing.length, fresh: fresh.length },
		});
		const expanded = await mapWithConcurrency(
			fresh,
			RPP_FETCH_CONCURRENCY,
			(entry) => expandEntry(entry, context),
		);
		return expanded.flatMap((record) => record ?? []);
	},
	toIncident(record): IncidentRecord | null {
		if (!record.relevant || !record.category || !record.severity) {
			return null;
		}
		const classification = record.classification;
		return {
			sourceId: record.sourceId,
			category: record.category,
			severity: record.severity,
			title: record.title,
			description: record.excerpt ?? null,
			status:
				typeof classification.status === "string"
					? classification.status
					: null,
			roadStatus: null,
			roadCode: null,
			roadName: null,
			roadKm: null,
			lat: null,
			lng: null,
			geometry: null,
			region: record.region ?? null,
			provincia: null,
			distrito: null,
			occurredAt: record.publishedAt ?? null,
			sourceUpdatedAt: null,
			validFrom: null,
			validUntil: null,
			attributes: {
				url: record.url,
				section: record.section,
				relevance: record.relevance,
				classification,
			},
		};
	},
};
