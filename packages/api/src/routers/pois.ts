import { POI_KINDS, poi } from "@hack-the-andes-project/db/schema/scraper";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { SCRAPER_ACTIVE } from "../constants";
import { getBoundingBoxFilter } from "../filters";
import { protectedProcedure } from "../index";
import { boundingBoxSchema, geometrySchema } from "../schemas";

export const poisRouter = {
	list: protectedProcedure
		.input(
			z.object({
				kinds: z.array(z.enum(POI_KINDS)).max(POI_KINDS.length),
				bbox: boundingBoxSchema.optional(),
			}),
		)
		.output(
			z.array(
				z.object({
					id: z.string(),
					kind: z.enum(POI_KINDS),
					name: z.string(),
					lat: z.number().nullable(),
					lng: z.number().nullable(),
					geometry: geometrySchema.nullable(),
					region: z.string().nullable(),
					roadCodes: z.array(z.string()).nullable(),
				}),
			),
		)
		.handler(async ({ context, input }) => {
			const pois = await context.db
				.select({
					id: poi.id,
					kind: poi.kind,
					name: poi.name,
					lat: poi.lat,
					lng: poi.lng,
					geometry: poi.geometry,
					region: poi.region,
					roadCodes: poi.roadCodes,
				})
				.from(poi)
				.where(
					and(
						eq(poi.active, SCRAPER_ACTIVE),
						inArray(poi.kind, input.kinds),
						getBoundingBoxFilter(poi, input.bbox),
					),
				);

			context.log.set({
				pois: { count: pois.length, hasBbox: Boolean(input.bbox) },
			});
			return pois;
		}),
};
