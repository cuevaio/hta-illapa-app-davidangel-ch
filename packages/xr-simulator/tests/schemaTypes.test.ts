import capas from "@hack-the-andes-project/tiles-schema/capas.schema.json";
import openapi from "@hack-the-andes-project/tiles-schema/openapi.json";
import tileMetadata from "@hack-the-andes-project/tiles-schema/tile-metadata.schema.json";
import { describe, expect, it } from "vitest";
import committed from "../../tiles-schema/types.ts?raw";
import { generateTypes } from "../tools/tiles-types";

describe("shared tiles schema types (packages/tiles-schema/types.ts)", () => {
	it("are up to date with the JSON Schemas (regenerate with npm run schema:types)", () => {
		expect(committed).toBe(generateTypes({ capas, tileMetadata, openapi }));
	});

	it("turn required, optional, nullable, nested and referenced fields into TypeScript", () => {
		const ts = generateTypes({
			capas: {
				title: "Capas",
				type: "object",
				required: ["capas"],
				properties: {
					capas: { type: "array", items: { $ref: "#/$defs/Capa" } },
				},
				$defs: {
					Capa: {
						type: "object",
						required: ["id", "res"],
						properties: {
							id: { type: "string", description: "Id" },
							res: { anyOf: [{ type: "number" }, { type: "null" }] },
							extra: { type: "object", additionalProperties: true },
						},
					},
				},
			},
			tileMetadata: {
				title: "TileMetadata",
				type: "object",
				required: ["z"],
				properties: { z: { type: "integer" } },
			},
			openapi: {
				components: {
					schemas: {
						Salud: { type: "object", properties: { ok: { type: "boolean" } } },
						Error: {
							type: "object",
							required: ["error"],
							properties: { error: { type: "string" } },
						},
					},
				},
			},
		});
		expect(ts).toContain("export interface Capas {\n  capas: Capa[];\n}");
		expect(ts).toContain(
			"  /** Id */\n  id: string;\n  res: number | null;\n  extra?: {\n    [key: string]: unknown;\n  };",
		);
		expect(ts).toContain("export interface TileMetadata {\n  z: number;\n}");
		expect(ts).toContain("export interface Salud {\n  ok?: boolean;\n}");
	});

	it("refuses conflicting definitions of the same model", () => {
		const capas = {
			title: "Capas",
			type: "object",
			properties: {},
			$defs: {
				Error: { type: "object", properties: { a: { type: "string" } } },
			},
		};
		expect(() =>
			generateTypes({
				capas,
				tileMetadata: { title: "TileMetadata", type: "object" },
				openapi: {
					components: {
						schemas: {
							Salud: { type: "object" },
							Error: { type: "object", properties: { b: { type: "string" } } },
						},
					},
				},
			}),
		).toThrow(/Conflicting/);
	});
});
