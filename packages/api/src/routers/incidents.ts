import {
	INCIDENT_CATEGORIES,
	INCIDENT_SEVERITIES,
	incident,
	ROAD_STATUSES,
} from "@hack-the-andes-project/db/schema/scraper";
import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import { z } from "zod";

import {
	DEFAULT_INCIDENT_LIMIT_ROWS,
	MAX_INCIDENT_LIMIT_ROWS,
	SCRAPER_ACTIVE,
} from "../constants";
import { getBoundingBoxFilter } from "../filters";
import { protectedProcedure } from "../index";
import { boundingBoxSchema, geometrySchema } from "../schemas";

export const incidentsRouter = {
	list: protectedProcedure
		.input(
			z.object({
				bbox: boundingBoxSchema.optional(),
				categories: z
					.array(z.enum(INCIDENT_CATEGORIES))
					.max(INCIDENT_CATEGORIES.length)
					.optional(),
				severities: z
					.array(z.enum(INCIDENT_SEVERITIES))
					.max(INCIDENT_SEVERITIES.length)
					.optional(),
				since: z.date().optional(),
				limit: z
					.number()
					.int()
					.positive()
					.max(MAX_INCIDENT_LIMIT_ROWS)
					.default(DEFAULT_INCIDENT_LIMIT_ROWS),
			}),
		)
		.output(
			z.array(
				z.object({
					id: z.string(),
					source: z.string(),
					category: z.enum(INCIDENT_CATEGORIES),
					severity: z.enum(INCIDENT_SEVERITIES),
					title: z.string(),
					description: z.string().nullable(),
					imageUrl: z.string().nullable(),
					status: z.string().nullable(),
					roadStatus: z.enum(ROAD_STATUSES).nullable(),
					roadCode: z.string().nullable(),
					roadName: z.string().nullable(),
					roadKm: z.string().nullable(),
					lat: z.number().nullable(),
					lng: z.number().nullable(),
					geometry: geometrySchema.nullable(),
					region: z.string().nullable(),
					provincia: z.string().nullable(),
					distrito: z.string().nullable(),
					occurredAt: z.date().nullable(),
					validFrom: z.date().nullable(),
					validUntil: z.date().nullable(),
					lastChangedAt: z.date(),
				}),
			),
		)
		.handler(async ({ context, input }) => {
			const incidents = await context.db
				.select({
					id: incident.id,
					source: incident.source,
					category: incident.category,
					severity: incident.severity,
					title: incident.title,
					description: incident.description,
					imageUrl: incident.imageUrl,
					status: incident.status,
					roadStatus: incident.roadStatus,
					roadCode: incident.roadCode,
					roadName: incident.roadName,
					roadKm: incident.roadKm,
					lat: incident.lat,
					lng: incident.lng,
					geometry: incident.geometry,
					region: incident.region,
					provincia: incident.provincia,
					distrito: incident.distrito,
					occurredAt: incident.occurredAt,
					validFrom: incident.validFrom,
					validUntil: incident.validUntil,
					lastChangedAt: incident.lastChangedAt,
				})
				.from(incident)
				.where(
					and(
						eq(incident.active, SCRAPER_ACTIVE),
						getBoundingBoxFilter(incident, input.bbox),
						input.categories && inArray(incident.category, input.categories),
						input.severities && inArray(incident.severity, input.severities),
						input.since && gt(incident.lastChangedAt, input.since),
					),
				)
				.orderBy(desc(incident.lastChangedAt))
				.limit(input.limit);

			context.log.set({
				incidents: {
					list: {
						count: incidents.length,
						limit: input.limit,
						hasBbox: Boolean(input.bbox),
						since: input.since,
					},
				},
			});
			return incidents;
		}),
	summary: protectedProcedure
		.input(z.void())
		.output(
			z.object({
				byCategory: z.array(
					z.object({
						category: z.enum(INCIDENT_CATEGORIES),
						count: z.number().int().nonnegative(),
					}),
				),
				bySeverity: z.array(
					z.object({
						severity: z.enum(INCIDENT_SEVERITIES),
						count: z.number().int().nonnegative(),
					}),
				),
			}),
		)
		.handler(async ({ context }) => {
			const [byCategory, bySeverity] = await Promise.all([
				context.db
					.select({ category: incident.category, count: count() })
					.from(incident)
					.where(eq(incident.active, SCRAPER_ACTIVE))
					.groupBy(incident.category),
				context.db
					.select({ severity: incident.severity, count: count() })
					.from(incident)
					.where(eq(incident.active, SCRAPER_ACTIVE))
					.groupBy(incident.severity),
			]);

			context.log.set({
				incidents: {
					summary: {
						categoryGroups: byCategory.length,
						severityGroups: bySeverity.length,
					},
				},
			});
			return { byCategory, bySeverity };
		}),
};
