import { describe, expect, it } from "vitest";
import { pointLabel } from "../src/map/overviewState";
import { ICONS, iconDataUrl } from "../src/ui/icons";
import { panelFooter, pointCardContent } from "../src/ui/sections";

const P = { lon: -77.0428, lat: -12.0464, height: 154 };

describe("pointLabel (web pick info and VR card)", () => {
	it("formats lon / lat / cota as the web overview always did", () => {
		expect(pointLabel(P)).toBe("Lon -77,0428 · Lat -12,0464 · Cota 154 m");
		expect(pointLabel({ ...P, height: null })).toBe(
			"Lon -77,0428 · Lat -12,0464 · Cota sin datos",
		);
	});
});

describe('pointCardContent (VR "Simular aquí" card)', () => {
	it("is hidden without a marked point", () => {
		expect(
			pointCardContent({
				picked: null,
				busy: false,
				error: null,
				view: "vuelo",
			}).visible,
		).toBe(false);
	});

	it('shows the point with "Simular aquí" and "Cancelar"', () => {
		const c = pointCardContent({
			picked: P,
			busy: false,
			error: null,
			view: "vuelo",
		});
		expect(c).toMatchObject({
			visible: true,
			title: "Punto marcado",
			coords: pointLabel(P),
			simulate: true,
			cancel: true,
			status: null,
		});
		expect(c.actions.map((a) => a.text)).toEqual(["Simular aquí", "Cancelar"]);
		expect(c.views.map((v) => [v.text, v.active])).toEqual([
			["Vuelo", true],
			["Maqueta", false],
		]);
	});

	it("disables both actions while the terrain downloads and shows the error after a failure", () => {
		const busy = pointCardContent({
			picked: P,
			busy: true,
			error: null,
			view: "maqueta",
		});
		expect(busy).toMatchObject({
			simulate: false,
			cancel: false,
			status: expect.stringMatching(/Descargando el terreno real/),
		});
		expect(busy.views.map((v) => v.active)).toEqual([false, true]);
		const failed = pointCardContent({
			picked: P,
			busy: false,
			error: "sin red",
			view: "vuelo",
		});
		expect(failed).toMatchObject({
			simulate: true,
			status: "No se pudo preparar la simulación: sin red",
		});
	});
});

describe("pointCardContent: the viewer's other simulators (S5)", () => {
	const entries = [{ id: "structures", label: "Simulador de estructuras" }];

	it("adds one button per other simulator, opening it at its own origin", () => {
		const c = pointCardContent({
			picked: P,
			busy: false,
			error: null,
			view: "vuelo",
			entries,
		});
		expect(c.entries).toEqual([
			{
				id: "mode:structures",
				icon: "maquette",
				text: "Simulador de estructuras",
				enabled: true,
			},
		]);
		expect(c.actions.map((a) => a.text)).toEqual(["Simular aquí", "Cancelar"]);
	});

	it("keeps the huayco-only card without other simulators", () => {
		expect(
			pointCardContent({ picked: P, busy: false, error: null, view: "vuelo" })
				.entries,
		).toEqual([]);
	});

	it("disables every action while a simulator opens and names it in the status", () => {
		const c = pointCardContent({
			picked: P,
			busy: true,
			error: null,
			view: "vuelo",
			entries,
			opening: "Simulador de estructuras",
		});
		expect(c).toMatchObject({
			simulate: false,
			cancel: false,
			status: "Abriendo Simulador de estructuras…",
		});
		expect(c.entries.map((e) => e.enabled)).toEqual([false]);
	});
});

describe("panelFooter (simulator VR panel)", () => {
	it('keeps "Salir de VR" and adds "Volver al mapa del Perú" only when the map is reachable', () => {
		expect(panelFooter({ backToMap: false }).map((a) => a.text)).toEqual([
			"Salir de VR",
		]);
		expect(panelFooter({ backToMap: true }).map((a) => a.text)).toEqual([
			"Volver al mapa del Perú",
			"Salir de VR",
		]);
	});

	it("has icons for the new VR actions", () => {
		for (const name of ["map", "close", "fly"] as const) {
			expect(ICONS[name]).toBeTruthy();
			expect(decodeURIComponent(iconDataUrl(name, "#fff"))).toContain("<svg");
		}
	});
});
