import { describe, expect, it } from "vitest";
import {
	BRIDGE_PARAMETERS,
	BYPASS_PARAMETERS,
	TUNNEL_PARAMETERS,
} from "./catalog";
import { bypassWidthM, structureGradePercent } from "./geometry";
import {
	createDefaultStructureTemplate,
	type PlacementPoint,
	terrainGradient,
} from "./placement";

const point = { x: 40, y: 2500, z: 60 };
const heightAt = ({ x, z }: { x: number; z: number }) =>
	point.y + (x - point.x) * 0.2 + (z - point.z) * 0.1;
describe("terrain-oriented catalog placement", () => {
	for (const kind of ["bridge", "bypass"] satisfies ("bridge" | "bypass")[]) {
		it(`${kind} follows the contour with terrain-relative endpoints`, () => {
			const template = createDefaultStructureTemplate(kind, point, heightAt);
			const endpoints: PlacementPoint[] =
				template.kind === "bypass"
					? template.points
					: [template.start, template.end];
			const start = endpoints[0];
			const end = endpoints[1];
			if (!start || !end) throw new Error("Missing endpoints");
			expect((end.x - start.x) * 0.2 + (end.z - start.z) * 0.1).toBeCloseTo(0);
			expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeCloseTo(
				kind === "bridge"
					? BRIDGE_PARAMETERS.defaultSpanM
					: BYPASS_PARAMETERS.defaultLengthM,
			);
			for (const endpoint of endpoints)
				expect(endpoint.y + point.y).toBeCloseTo(
					heightAt({ x: point.x + endpoint.x, z: point.z + endpoint.z }),
				);
		});
	}
	it("orients the tunnel uphill and uses catalog section dimensions", () => {
		const template = createDefaultStructureTemplate("tunnel", point, heightAt);
		if (template.kind !== "tunnel") throw new Error("Expected tunnel");
		expect(template.end.y).toBeGreaterThan(template.start.y);
		expect(
			(template.end.x - template.start.x) * 0.1 -
				(template.end.z - template.start.z) * 0.2,
		).toBeCloseTo(0);
		expect(
			Math.hypot(
				template.end.x - template.start.x,
				template.end.z - template.start.z,
			),
		).toBeCloseTo(TUNNEL_PARAMETERS.defaultLengthM);
		expect(template.sectionWidthM).toBe(
			TUNNEL_PARAMETERS.sectionWidthM.default,
		);
	});
	it("uses a deterministic direction on flat or unavailable heights", () => {
		const template = createDefaultStructureTemplate(
			"tunnel",
			point,
			() => null,
		);
		if (template.kind !== "tunnel") throw new Error("Expected tunnel");
		expect(template.end.x - template.start.x).toBe(
			TUNNEL_PARAMETERS.defaultLengthM,
		);
		expect(template.start.y).toBe(0);
		expect(template.end.z).toBe(0);
	});
	it("reports central-difference terrain slope and template grade as percentages", () => {
		expect(terrainGradient(point, heightAt).slopePercent).toBeCloseTo(
			Math.hypot(0.2, 0.1) * 100,
		);
		expect(
			structureGradePercent({
				kind: "tunnel",
				start: { x: 0, y: 0, z: 0 },
				end: { x: 100, y: 10, z: 0 },
			}),
		).toBe(10);
	});
	it("includes both shoulders in the bypass width", () => {
		expect(bypassWidthM({ laneCount: 2, laneWidthM: 3.5 })).toBe(9);
	});
});
