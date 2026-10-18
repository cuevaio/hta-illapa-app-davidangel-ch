import type { SceneStructure } from "@hack-the-andes-project/ui/lib/structure-scene";
import { describe, expect, it, vi } from "vitest";
import { structureEditorFields } from "./structure-editor-fields";
import { structureEditorLabels } from "./structure-editor-labels";

const bridge: SceneStructure = {
	id: "bridge-measurements",
	name: "Puente 1",
	status: "planned",
	notes: "",
	anchor: { lat: -11.84, lng: -76.39, elevationM: 2126.533 },
	template: {
		kind: "bridge",
		start: { x: 0, y: 0, z: 0 },
		end: { x: 128.022, y: 0, z: 0 },
		deckWidthM: 10,
		pierCount: 2,
		deckMaterial: "concrete",
	},
	elements: [],
};

describe("editor measurement display", () => {
	it.each([
		{ locale: "es", expected: "128,0 m" },
		{ locale: "en", expected: "128.0 m" },
	])(
		"formats bridge span with one decimal in $locale",
		({ locale, expected }) => {
			const fields = structureEditorFields(
				bridge,
				undefined,
				structureEditorLabels(),
				locale,
				vi.fn(),
			);
			expect(fields.find((field) => field.id === "length")?.value).toBe(
				expected,
			);
		},
	);

	it("rounds elevation to whole metres", () => {
		const fields = structureEditorFields(
			bridge,
			undefined,
			structureEditorLabels(),
			"es",
			vi.fn(),
		);
		expect(fields.find((field) => field.id === "location")?.value).toContain(
			"2127 m",
		);
	});

	it("formats tunnel and bypass lengths with one decimal", () => {
		const structures: SceneStructure[] = [
			{
				...bridge,
				template: {
					kind: "tunnel",
					start: { x: 0, y: 0, z: 0 },
					end: { x: 60.047, y: 0, z: 0 },
					sectionWidthM: 10,
					sectionHeightM: 7,
					shape: "horseshoe",
				},
			},
			{
				...bridge,
				template: {
					kind: "bypass",
					points: [
						{ x: 0, y: 0, z: 0 },
						{ x: 60.047, y: 0, z: 0 },
					],
					laneCount: 2,
					laneWidthM: 3.3,
				},
			},
		];
		for (const structure of structures) {
			const fields = structureEditorFields(
				structure,
				undefined,
				structureEditorLabels(),
				"es",
				vi.fn(),
			);
			expect(fields.find((field) => field.id === "length")?.value).toBe(
				"60,0 m",
			);
		}
	});
});
