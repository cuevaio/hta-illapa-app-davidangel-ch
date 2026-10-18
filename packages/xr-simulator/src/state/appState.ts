import {
	type CommandHistory,
	newCommandId,
	type SourceCommand,
	type WallMaterial,
} from "../edit/commands";
import type { QualityProfileId } from "../platform/quality";
import { DEFAULT_MATERIAL, triangularHydrograph } from "../solver/params";
import type { EmitterParams, MaterialParams } from "../solver/Solver";
import { Store } from "./store";

export interface EmitterSettings {
	position: [number, number];
	radius: number;
	/** Total released volume (m³). */
	volume: number;
	/** Peak discharge of the triangular hydrograph (m³/s). */
	peakDischarge: number;
	enabled: boolean;
}

export type ColorMode = "depth" | "speed";
export type ToolId = "navigate" | "source" | "wall" | "erase";

/** Typical dimensions per barrier type, applied when the user switches type. */
export const WALL_DEFAULTS: Record<
	WallMaterial,
	{ halfWidth: number; height: number }
> = {
	earth: { halfWidth: 12, height: 8 },
	concrete: { halfWidth: 0.5, height: 5 },
};

export type XrViewMode = "maquette" | "immersive";

export interface XrSettings {
	mode: XrViewMode;
	/** Maquette table size: the whole terrain fits this many metres. */
	tableSize: number;
	/** Maquette: snap aimed points to a grid of this many terrain metres (0 = off). */
	snap: number;
	/** Maquette: controller ray smoothing in [0, 0.95) (0 = follows the hand exactly). */
	smoothing: number;
}

export interface WallSettings {
	material: WallMaterial;
	/** Real half thickness (m). */
	halfWidth: number;
	height: number;
	/** Walls cannot be placed where the flow is deeper than this (m). */
	maxFlowDepth: number;
}

export interface AppState {
	material: MaterialParams;
	emitter: EmitterSettings;
	playback: {
		playing: boolean /** Simulated seconds per real second. */;
		speed: number;
	};
	view: {
		colorMode: ColorMode;
		contours: boolean;
		depthScale: number;
		speedScale: number;
	};
	quality: { profile: QualityProfileId; auto: boolean };
	/** Active interaction tool. */
	tool: ToolId;
	wall: WallSettings;
	/** Edit commands and redo stack: the effective terrain is derived from this. */
	history: CommandHistory;
	xr: XrSettings;
	terrainLabel: string;
	session: "web" | "xr";
	/** Recording of the live run and playback of precomputed frames ("result" mode). */
	result: ResultState;
}

export interface ResultState {
	mode: "live" | "result";
	recording: boolean;
	frames: number;
	start: number;
	end: number;
	/** Playhead (simulated seconds). */
	time: number;
	playing: boolean;
	speed: number;
}

/** Solver emitter for one origin command, starting at `startTime`; `enabled` is the global switch. */
export function sourceEmitter(
	src: SourceCommand,
	startTime: number,
	enabled: boolean,
): EmitterParams {
	return {
		position: src.pos,
		radius: src.radius,
		hydrograph: triangularHydrograph(src.volume, src.peakDischarge),
		enabled,
		startTime,
	};
}

/** Origin command at `pos` with the panel's settings for new origins. */
export function newSource(
	e: EmitterSettings,
	pos: [number, number],
): SourceCommand {
	return {
		type: "source",
		id: newCommandId("source"),
		pos,
		radius: e.radius,
		peakDischarge: e.peakDischarge,
		volume: e.volume,
	};
}

const DEFAULT_EMITTER_SETTINGS: EmitterSettings = {
	position: [0, 0],
	radius: 30,
	volume: 60_000,
	peakDischarge: 300,
	enabled: true,
};

export function createAppStore(init: {
	profile: QualityProfileId;
	emitterPosition: [number, number];
	terrainLabel: string;
}): Store<AppState> {
	return new Store<AppState>({
		material: { ...DEFAULT_MATERIAL },
		emitter: { ...DEFAULT_EMITTER_SETTINGS, position: init.emitterPosition },
		playback: { playing: true, speed: 10 },
		view: { colorMode: "depth", contours: true, depthScale: 5, speedScale: 15 },
		quality: { profile: init.profile, auto: true },
		tool: "navigate",
		wall: { material: "earth", ...WALL_DEFAULTS.earth, maxFlowDepth: 0.2 },
		// The terrain's default origin is an ordinary command: it can be undone or erased.
		history: {
			commands: [newSource(DEFAULT_EMITTER_SETTINGS, init.emitterPosition)],
			redo: [],
		},
		xr: { mode: "maquette", tableSize: 1.2, snap: 0, smoothing: 0.6 },
		terrainLabel: init.terrainLabel,
		session: "web",
		result: {
			mode: "live",
			recording: false,
			frames: 0,
			start: 0,
			end: 0,
			time: 0,
			playing: false,
			speed: 20,
		},
	});
}
