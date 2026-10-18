import { describe, expect, it } from "vitest";
import { nextStructureName, structureElementName } from "./naming";

describe("default structure names", () => {
	it("uses the next free number for the kind and localized label", () => {
		expect(
			nextStructureName(
				[
					{ name: "Puente 1", template: { kind: "bridge" } },
					{ name: "Puente 3", template: { kind: "bridge" } },
				],
				"bridge",
				"Puente",
			),
		).toBe("Puente 2");
		expect(
			nextStructureName(
				[{ name: "Puente 1", template: { kind: "bridge" } }],
				"tunnel",
				"Túnel",
			),
		).toBe("Túnel 1");
	});
	it("numbers standalone primitives independently", () => {
		expect(
			nextStructureName(
				[
					{ name: "Columna 1", template: { kind: "entity" } },
					{ name: "Bloque 1", template: { kind: "entity" } },
				],
				"entity",
				"Columna",
			),
		).toBe("Columna 2");
		expect(nextStructureName([], "bridge", "Bridge")).toBe("Bridge 1");
	});
});

describe("element ordinals", () => {
	it("counts only preceding elements of the same kind", () => {
		const elements = [
			{ id: "first", kind: "column" },
			{ id: "beam", kind: "beam" },
			{ id: "second", kind: "column" },
		];
		expect(structureElementName(elements, "second", "Columna")).toBe(
			"Columna 2",
		);
		expect(structureElementName(elements, "beam", "Beam")).toBe("Beam 1");
	});
});
