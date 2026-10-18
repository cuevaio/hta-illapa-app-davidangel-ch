/**
 * VR inside one immersive session (S2): the Peru map (flight or maquette) and the simulator
 * share a single XRSession (src/xr/sharedSession.ts), so "Simular aquí" and "Volver al mapa
 * del Perú" never take the headset off. Pure rules: the phase machine and the controller
 * mapping per map view.
 */

/** Map view in VR: free flight over the 1:1000 relief, or the whole of Peru on a table. */
export type VrView = "vuelo" | "maqueta";

/** off: no session · map · loading: "Simular aquí" downloading (map still shown) · simulator. */
export type VrPhase = "off" | "map" | "loading" | "simulator";

export interface VrState {
	phase: VrPhase;
	view: VrView;
	/** Mode the session was requested with (the map is VR only). */
	sessionMode: XRSessionMode | null;
	/** Last "Simular aquí" failure, shown on the card until the next attempt. */
	error: string | null;
}

export type VrEvent =
	| { type: "enter-map" }
	| { type: "enter-simulator"; mode: XRSessionMode }
	| { type: "toggle-view" }
	| { type: "set-view"; view: VrView }
	| { type: "simulate" }
	| { type: "simulated" }
	| { type: "failed"; message: string }
	| { type: "back-to-map" }
	| { type: "exit" };

export const VR_OFF: VrState = {
	phase: "off",
	view: "vuelo",
	sessionMode: null,
	error: null,
};

export function vrReduce(s: VrState, e: VrEvent): VrState {
	switch (e.type) {
		case "enter-map":
			return s.phase === "off"
				? {
						phase: "map",
						view: "vuelo",
						sessionMode: "immersive-vr",
						error: null,
					}
				: s;
		case "enter-simulator":
			return s.phase === "off"
				? { ...VR_OFF, phase: "simulator", sessionMode: e.mode }
				: s;
		case "toggle-view":
			return s.phase === "map"
				? { ...s, view: s.view === "vuelo" ? "maqueta" : "vuelo" }
				: s;
		case "set-view":
			return s.phase === "map" ? { ...s, view: e.view } : s;
		case "simulate":
			return s.phase === "map" ? { ...s, phase: "loading", error: null } : s;
		case "simulated":
			return s.phase === "loading" ? { ...s, phase: "simulator" } : s;
		case "failed":
			return s.phase === "loading"
				? { ...s, phase: "map", error: e.message }
				: s;
		case "back-to-map":
			return canReturnToMap(s, true) ? { ...s, phase: "map", error: null } : s;
		case "exit":
			return VR_OFF;
	}
}

/** "Volver al mapa del Perú" in the simulator panel: VR sessions only, with the map available. */
export function canReturnToMap(s: VrState, mapAvailable: boolean): boolean {
	return (
		s.phase === "simulator" && s.sessionMode === "immersive-vr" && mapAvailable
	);
}

/** Which XR experience renders the shared session in each phase. */
export function sessionOwner(phase: VrPhase): "map" | "simulator" | null {
	if (phase === "off") return null;
	return phase === "simulator" ? "simulator" : "map";
}

export type TriggerUse = "card" | "zoom" | "none";

/** The trigger on the card presses its buttons and never zooms; in maquette it does nothing else. */
export function triggerUse(view: VrView, cardHit: boolean): TriggerUse {
	if (cardHit) return "card";
	return view === "vuelo" ? "zoom" : "none";
}

/** Flight: grip + right stick climbs/turns. Maquette: the grips hold the table. */
export function gripUse(view: VrView): "climb-turn" | "table" {
	return view === "vuelo" ? "climb-turn" : "table";
}

/** Controller mapping per view (also documented in the README, Fase 7). */
export function mapControls(view: VrView): Record<string, string> {
	const common = {
		trigger: triggerUse(view, false),
		a: "mark",
		b: "exit",
		y: "toggle-view",
	};
	return view === "vuelo"
		? {
				...common,
				rightStick: "fly",
				rightStickPress: "boost",
				rightGrip: "climb-turn",
				rightGripDouble: "start-view",
				leftStick: "snap-turn",
			}
		: {
				...common,
				rightStick: "turn-table",
				rightGrip: "table",
				leftGrip: "table",
				rightGripDouble: "table-in-front",
			};
}

/** Controls card text above the right controller. */
export function controlsHint(view: VrView): string {
	return view === "vuelo"
		? "Joystick der.: adelante / atrás según tu mirada, a los lados para desplazarte (púlsalo: turbo) · " +
				"Grip der. (botón lateral) + joystick der.: subir / bajar y girar · Grip der. dos veces: volver a la vista inicial · " +
				"Gatillo: acercarte al punto señalado · Joystick izq.: giro de 30° · " +
				"A: marcar punto para «Simular aquí» · Y: maqueta · B: salir de VR"
		: "Grip (una mano): mover y girar la maqueta · Grip con las dos manos: escalarla · " +
				"Joystick der.: girar 30° · Grip der. dos veces: maqueta delante de ti · " +
				"A: marcar punto para «Simular aquí» · Y: vuelo · B: salir de VR";
}
