import { describe, expect, it } from "vitest";
import {
	canReturnToMap,
	controlsHint,
	gripUse,
	mapControls,
	sessionOwner,
	triggerUse,
	VR_OFF,
	type VrEvent,
	type VrState,
	vrReduce,
} from "../src/xr/vrMode";

const run = (events: VrEvent[], from: VrState = VR_OFF) =>
	events.reduce(vrReduce, from);

describe("VR mode state machine (one immersive session: vuelo / maqueta / simulación)", () => {
	it("enters the map in flight and toggles Vuelo / Maqueta only on the map", () => {
		const map = run([{ type: "enter-map" }]);
		expect(map).toMatchObject({
			phase: "map",
			view: "vuelo",
			sessionMode: "immersive-vr",
		});
		expect(run([{ type: "toggle-view" }], map).view).toBe("maqueta");
		expect(
			run([{ type: "toggle-view" }, { type: "toggle-view" }], map).view,
		).toBe("vuelo");
		expect(run([{ type: "set-view", view: "maqueta" }], map).view).toBe(
			"maqueta",
		);
		const sim = run([{ type: "simulate" }, { type: "simulated" }], map);
		expect(run([{ type: "toggle-view" }], sim)).toEqual(sim);
	});

	it("simulates from the map and comes back to it inside the same session, keeping the view", () => {
		const maq = run([{ type: "enter-map" }, { type: "toggle-view" }]);
		const loading = run([{ type: "simulate" }], maq);
		expect(loading.phase).toBe("loading");
		// A second "Simular aquí" while downloading is ignored.
		expect(run([{ type: "simulate" }], loading)).toEqual(loading);
		const sim = run([{ type: "simulated" }], loading);
		expect(sim.phase).toBe("simulator");
		expect(sessionOwner(loading.phase)).toBe("map");
		expect(sessionOwner(sim.phase)).toBe("simulator");
		const back = run([{ type: "back-to-map" }], sim);
		expect(back).toMatchObject({ phase: "map", view: "maqueta", error: null });
	});

	it("a failed download stays on the map with the message; exit ends everything", () => {
		const failed = run([
			{ type: "enter-map" },
			{ type: "simulate" },
			{ type: "failed", message: "sin red" },
		]);
		expect(failed).toMatchObject({ phase: "map", error: "sin red" });
		expect(run([{ type: "simulate" }], failed).error).toBeNull();
		expect(run([{ type: "exit" }], failed)).toEqual(VR_OFF);
		expect(sessionOwner("off")).toBeNull();
	});

	it("keeps the simulator XR entered from the web as before (VR or AR), with the way to the map only in VR", () => {
		const vr = run([{ type: "enter-simulator", mode: "immersive-vr" }]);
		expect(vr).toMatchObject({
			phase: "simulator",
			sessionMode: "immersive-vr",
		});
		expect(canReturnToMap(vr, true)).toBe(true);
		expect(canReturnToMap(vr, false)).toBe(false);
		const ar = run([{ type: "enter-simulator", mode: "immersive-ar" }]);
		expect(ar.phase).toBe("simulator");
		expect(canReturnToMap(ar, true)).toBe(false);
		expect(run([{ type: "back-to-map" }], ar)).toEqual(ar);
		expect(canReturnToMap(run([{ type: "enter-map" }]), true)).toBe(false);
	});
});

describe("VR map controls per mode", () => {
	it("keeps the flight controls (grip climb/turn, trigger zoom, A mark, B exit, left stick snap)", () => {
		expect(gripUse("vuelo")).toBe("climb-turn");
		expect(triggerUse("vuelo", false)).toBe("zoom");
		const flight = mapControls("vuelo");
		expect(flight).toMatchObject({
			rightStick: "fly",
			rightStickPress: "boost",
			rightGrip: "climb-turn",
			rightGripDouble: "start-view",
			trigger: "zoom",
			leftStick: "snap-turn",
			a: "mark",
			b: "exit",
			y: "toggle-view",
		});
	});

	it("in maquette the grips manipulate the table and the trigger does not zoom", () => {
		expect(gripUse("maqueta")).toBe("table");
		expect(triggerUse("maqueta", false)).toBe("none");
		expect(mapControls("maqueta")).toMatchObject({
			rightGrip: "table",
			leftGrip: "table",
			rightStick: "turn-table",
			rightGripDouble: "table-in-front",
			a: "mark",
			b: "exit",
			y: "toggle-view",
		});
	});

	it("a trigger on the card belongs to the card, never to the zoom", () => {
		expect(triggerUse("vuelo", true)).toBe("card");
		expect(triggerUse("maqueta", true)).toBe("card");
	});

	it("describes the controls of each mode in Spanish", () => {
		expect(controlsHint("vuelo")).toMatch(/Gatillo: acercarte/);
		expect(controlsHint("vuelo")).toMatch(/Y: maqueta/);
		expect(controlsHint("maqueta")).toMatch(/Grip/);
		expect(controlsHint("maqueta")).toMatch(/Y: vuelo/);
		for (const view of ["vuelo", "maqueta"] as const)
			expect(controlsHint(view)).toMatch(/X: capas meteorológicas/);
	});
});
