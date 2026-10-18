import type { AbstractEngine } from "@babylonjs/core";
import type {
	ImageryAvailability,
	ImageryMode,
	ImagerySource,
} from "../map/imagery/imagerySource";
import type { LodProfile } from "../map/lod/lodProfile";
import type { PeruOverview, PickedPoint } from "../map/PeruOverview";
import type { TilesClient } from "../map/tilesClient";
import type { WeatherController } from "../map/weather/WeatherController";
import type { WeatherGpu } from "../map/weather/WeatherGpu";
import type { CapabilitySummary } from "../platform/capabilities";
import type { XrSessionMember } from "../xr/sharedSession";
import type { VrEvent, VrState } from "../xr/vrMode";
import type { SwitchableMode } from "./ModeSwitcher";
import type { SiteTerrain, SiteTerrainOptions } from "./SiteTerrain";

/** A mode's immersive side, as the shell hands the shared XR session around (src/xr/sharedSession.ts). */
export interface ModeXr {
	readonly member: XrSessionMember;
	/** Requests a new session, or adopts the shared one during a hand-over. */
	enter(mode: XRSessionMode): Promise<void>;
	/** The Peru map takes the shared session. */
	pause(): void;
	/** The mode gets the shared session back. */
	resume(): void;
}

/** The shared VR session (S2) seen from a mode: one XRSession for the map and every simulator. */
export interface ModeVr {
	state(): VrState;
	dispatch(event: VrEvent): void;
	/** The mode's XR entered a session of its own (web "Entrar en VR/AR"). */
	started(xr: ModeXr, mode: XRSessionMode): Promise<void>;
	/** VR "Simular aquí": the mode takes the map's session, staying in VR. */
	takeFromMap(modeId: string, xr: ModeXr): Promise<void>;
	/** "Volver al mapa del Perú" in the mode's VR panel. */
	backToMap(xr: ModeXr): Promise<void>;
	/**
	 * The VR map card opened the mode (S5): it takes the map's session, staying in VR. False when
	 * no VR map is shown (the web flow then applies).
	 */
	enterFromMap(modeId: string, xr: ModeXr): Promise<boolean>;
	/** The Peru map owns a running VR session (the card's actions come from inside the headset). */
	inMap(): boolean;
	/** "Volver al mapa del Perú" is possible from the mode's VR panel now. */
	mapReachable(): boolean;
}

/** What the viewer shell shares with its simulator modes. */
export interface ModeHost {
	readonly engine: AbstractEngine;
	readonly canvas: HTMLCanvasElement;
	readonly container: HTMLElement;
	readonly webgpu: boolean;
	readonly caps: CapabilitySummary;
	readonly tiles: TilesClient;
	readonly lodProfile: LodProfile;
	readonly weather: WeatherController;
	readonly weatherGpu: WeatherGpu;
	readonly overview: PeruOverview;
	readonly imagery: ImageryAvailability;
	readonly vr: ModeVr;
	imageryMode(): ImageryMode;
	/** "Relieve / Satélite" from a mode's switch: the overview and every mode follow. */
	setImageryMode(mode: ImageryMode): void;
	overviewActive(): boolean;
	/** Shows the Peru map; `fromVr` while a mode hands the shared session back. */
	showOverview(fromVr?: boolean): void;
	showMode(modeId: string): void;
	/** Real relief around a site from the viewer's tiles, with its imagery and weather context. */
	createSiteTerrain(options: SiteTerrainOptions): SiteTerrain;
}

/**
 * One simulator hosted by the viewer shell (huayco, structures…): it owns its Babylon scene,
 * content and UI, while the shell owns the engine, the Peru map, weather, tiles and XR session.
 */
export interface SimulatorMode extends SwitchableMode {
	/** Overview button opening this mode at its own origin; null when entered otherwise. */
	readonly entryLabel: string | null;
	/** Builds the mode once, before the overview offers it. */
	start(): Promise<void>;
	/** Loads the mode at a point picked on the map, or at its own origin, and shows it. */
	open(point: PickedPoint | null): Promise<void>;
	/** In an immersive session: the web "back to the map" waits for it to end. */
	presenting(): boolean;
	handleKey(event: KeyboardEvent): void;
	notify(message: string | null): void;
	imageryChanged(mode: ImageryMode, source: ImagerySource | null): void;
	imageryAttribution(text: string): void;
}

export type SimulatorModeFactory = (host: ModeHost) => SimulatorMode;
