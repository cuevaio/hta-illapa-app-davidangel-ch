import {
	INCIDENT_CATEGORIES,
	INCIDENT_SEVERITIES,
	POI_KINDS,
} from "@hack-the-andes-project/db/schema/scraper";
import { describe, expect, it } from "vitest";

import { incidentsRouter } from "./incidents";
import { poisRouter } from "./pois";

describe("map filter input limits", () => {
	it.each([
		{
			categories: Array(INCIDENT_CATEGORIES.length + 1).fill(
				INCIDENT_CATEGORIES[0],
			),
		},
		{
			severities: Array(INCIDENT_SEVERITIES.length + 1).fill(
				INCIDENT_SEVERITIES[0],
			),
		},
	])("rejects oversized incident filters", async (input) => {
		const schema = incidentsRouter.list["~orpc"].inputSchema;
		if (!schema) throw new Error("Incident input schema missing");
		expect((await schema["~standard"].validate(input)).issues).toBeDefined();
	});

	it("accepts all incident categories and severities", async () => {
		const schema = incidentsRouter.list["~orpc"].inputSchema;
		if (!schema) throw new Error("Incident input schema missing");
		expect(
			(
				await schema["~standard"].validate({
					categories: INCIDENT_CATEGORIES,
					severities: INCIDENT_SEVERITIES,
				})
			).issues,
		).toBeUndefined();
	});

	it("rejects oversized POI filters", async () => {
		const schema = poisRouter.list["~orpc"].inputSchema;
		if (!schema) throw new Error("POI input schema missing");
		expect(
			(
				await schema["~standard"].validate({
					kinds: Array(POI_KINDS.length + 1).fill(POI_KINDS[0]),
				})
			).issues,
		).toBeDefined();
	});

	it("accepts every POI kind", async () => {
		const schema = poisRouter.list["~orpc"].inputSchema;
		if (!schema) throw new Error("POI input schema missing");
		expect(
			(await schema["~standard"].validate({ kinds: POI_KINDS })).issues,
		).toBeUndefined();
	});
});
