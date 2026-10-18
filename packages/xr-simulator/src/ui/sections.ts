import { pointLabel } from "../map/overviewState";
import type { WeatherLayerId } from "../map/weather/catalog";
import { LEGEND_TITLE, legendText } from "../map/weather/legend";
import type { PointLine } from "../map/weather/pointQuery";
import { RAIN_SCALES } from "../map/weather/rain";
import type {
	WeatherController,
	WeatherSnapshot,
} from "../map/weather/WeatherController";
import type { ToolId, XrViewMode } from "../state/appState";
import type { VrView } from "../xr/vrMode";
import type { IconName } from "./icons";

export interface PanelSections {
	/** Settings for new origins. */
	source: boolean;
	/** Barrier type and wall height. */
	wall: boolean;
	/** Maquette size, grid snap and ray smoothing. */
	maquette: boolean;
	/** One-line gesture help for tools without settings. */
	hint: string | null;
}

/** Which panel parts are shown (3D and web): only the options of the active tool and mode. */
export function panelSections(s: {
	tool: ToolId;
	mode: XrViewMode;
	input?: "xr" | "web";
}): PanelSections {
	const hints: Partial<Record<ToolId, string>> =
		s.input === "web"
			? {
					navigate:
						"Arrastra para girar la cámara, clic derecho para desplazarla y la rueda para acercarte.",
					erase: "Haz clic sobre un muro u origen para borrarlo.",
				}
			: {
					navigate:
						"Mantén el grip para mover y girar la maqueta (con las dos manos, escalar). Joystick derecho: girar.",
					erase:
						"Apunta a un muro u origen y aprieta el gatillo para borrarlo.",
				};
	return {
		source: s.tool === "source",
		wall: s.tool === "wall",
		maquette: s.mode === "maquette",
		hint: hints[s.tool] ?? null,
	};
}

/** One button of a VR card or panel row. */
export interface CardAction {
	id: string;
	icon: IconName;
	text: string;
}

/** The VR "Simular aquí" card over the Peru map (src/ui/vr/VrPointCard.ts). */
export interface PointCardContent {
	visible: boolean;
	title: string;
	coords: string;
	/** Download progress or the last failure; null when idle. */
	status: string | null;
	simulate: boolean;
	cancel: boolean;
	actions: CardAction[];
	/** The viewer's other simulators (S5), opened at their own origin: "mode:<id>". */
	entries: (CardAction & { enabled: boolean })[];
	views: (CardAction & { active: boolean })[];
}

/** The VR weather menu (S8): every option of the web "Capas meteorológicas" panel. */
export interface WeatherMenuContent {
	/** Backend notice ("Conectando…", service down), null when none. */
	notice: string | null;
	/** One toggle per layer ("wx:<layer>"), with its opacity while enabled. */
	layers: (CardAction & {
		/** "observado" / "pronóstico", the web row's badge. */
		badge: string;
		active: boolean;
		disabled: boolean;
		/** "80 %", stepped with "wx:opacity-down:<layer>" / "wx:opacity-up:<layer>"; null while off. */
		opacity: string | null;
	})[];
	/** "Nubes: cargando…" for the layers with a status. */
	status: string[];
	/** Forecast timeline ("wx:prev", "wx:play", "wx:next") while a forecast layer is on. */
	time: { label: string; playing: boolean } | null;
	/** Precipitation scale ("wx:rain:<mode>") while rain is on. */
	rain: (CardAction & { active: boolean })[] | null;
	legends: { title: string; text: string }[];
	provenance: string[];
	/** Values at the marked point. */
	values: string[];
	credit: string | null;
}

export const WEATHER_LAYER_ICONS: Record<WeatherLayerId, IconName> = {
	clouds: "cloud",
	rain: "rain",
	lightning: "bolt",
	cape: "storm",
	wind: "wind",
	temperature: "thermo",
};

/** Opacity change of one "−" / "+" press in the VR menu (the web slider moves freely). */
export const WEATHER_OPACITY_STEP = 0.1;

export function weatherMenuContent(
	s: WeatherSnapshot,
	lines: PointLine[],
): WeatherMenuContent {
	const enabled = s.layers.filter((l) => l.enabled);
	const forecastOn = enabled.some((l) => l.kindLabel === "pronóstico");
	return {
		notice:
			s.notice ??
			(s.backend === "loading"
				? "Conectando con el servicio meteorológico…"
				: null),
		layers: s.layers.map((l) => ({
			id: `wx:${l.id}`,
			icon: WEATHER_LAYER_ICONS[l.id],
			text: l.title,
			badge: l.kindLabel,
			active: l.enabled,
			disabled: l.disabled,
			opacity: l.enabled ? `${Math.round(l.opacity * 100)} %` : null,
		})),
		status: s.layers
			.filter((l) => l.statusText)
			.map((l) => `${l.title}: ${l.statusText}`),
		time:
			forecastOn && s.times.length && s.timeLabel
				? {
						label: `Válido ${s.timeLabel}${s.leadLabel ? ` · ${s.leadLabel}` : ""}`,
						playing: s.playing,
					}
				: null,
		rain: enabled.some((l) => l.id === "rain")
			? (["rate", "accum"] as const).map((mode) => ({
					id: `wx:rain:${mode}`,
					icon: "rain",
					text: RAIN_SCALES[mode].label,
					active: s.rainMode === mode,
				}))
			: null,
		legends: enabled.map((l) => ({
			title: LEGEND_TITLE[l.id],
			text: legendText(l.id, s),
		})),
		provenance: s.provenance.map(
			(p) =>
				`${p.title} (${p.kindLabel}) · ${p.time} · Fuente: ${p.source}${p.notice ? ` · ${p.notice}` : ""}`,
		),
		values: lines.map((l) => `${l.label}: ${l.text}`),
		credit: s.attribution ? `Datos meteorológicos: ${s.attribution}` : null,
	};
}

/** The controller calls of the VR weather menu buttons, the same the web panel makes. */
export function weatherMenuAction(
	weather: Pick<
		WeatherController,
		"snapshot" | "toggle" | "step" | "setPlaying" | "setOpacity" | "setRainMode"
	>,
	id: string,
): void {
	const [, action, argument] = id.split(":");
	if (action === "prev") weather.step(-1);
	else if (action === "next") weather.step(1);
	else if (action === "play") weather.setPlaying(!weather.snapshot().playing);
	else if (action === "rain" && (argument === "rate" || argument === "accum"))
		weather.setRainMode(argument);
	else if (action === "opacity-up" || action === "opacity-down") {
		const layer = weather.snapshot().layers.find((l) => l.id === argument);
		if (!layer) return;
		const step =
			action === "opacity-up" ? WEATHER_OPACITY_STEP : -WEATHER_OPACITY_STEP;
		weather.setOpacity(
			layer.id,
			Math.round((layer.opacity + step) * 100) / 100,
		);
	} else {
		const layer = weather.snapshot().layers.find((l) => l.id === action);
		if (layer) weather.toggle(layer.id);
	}
}

/** Card buttons of the viewer's other simulators: "mode:<id>". */
export function entryActions(
	entries: { id: string; label: string }[],
): CardAction[] {
	return entries.map((entry) => ({
		id: `mode:${entry.id}`,
		icon: "maquette",
		text: entry.label,
	}));
}

export function pointCardContent(s: {
	picked: { lon: number; lat: number; height: number | null } | null;
	busy: boolean;
	error: string | null;
	view: VrView;
	entries?: { id: string; label: string }[];
	/** Label of the simulator being opened from the card, while busy. */
	opening?: string | null;
}): PointCardContent {
	return {
		visible: s.picked !== null,
		title: "Punto marcado",
		coords: s.picked ? pointLabel(s.picked) : "",
		status: s.busy
			? s.opening
				? `Abriendo ${s.opening}…`
				: "Descargando el terreno real de la zona (z11)…"
			: s.error
				? `No se pudo preparar la simulación: ${s.error}`
				: null,
		simulate: !!s.picked && !s.busy,
		cancel: !s.busy,
		actions: [
			{ id: "simulate", icon: "play", text: "Simular aquí" },
			{ id: "cancel", icon: "close", text: "Cancelar" },
		],
		entries: entryActions(s.entries ?? []).map((entry) => ({
			...entry,
			enabled: !s.busy,
		})),
		views: [
			{ id: "vuelo", icon: "fly", text: "Vuelo", active: s.view === "vuelo" },
			{
				id: "maqueta",
				icon: "maquette",
				text: "Maqueta",
				active: s.view === "maqueta",
			},
		],
	};
}

/** Last rows of the simulator VR panel: the way back to the Peru map (VR only) and "Salir de VR". */
export function panelFooter(s: {
	backToMap: boolean;
	/** The weather menu page (S8), when the simulator shows weather layers. */
	weather?: boolean;
	/** «Controles»: reopens the VR controls instructions (S15). */
	controls?: boolean;
}): CardAction[] {
	return [
		...(s.weather
			? [{ id: "weather", icon: "cloud" as const, text: "Meteorología" }]
			: []),
		...(s.backToMap
			? [
					{
						id: "backToMap",
						icon: "map" as const,
						text: "Volver al mapa del Perú",
					},
				]
			: []),
		...(s.controls
			? [{ id: "controls", icon: "help" as const, text: "Controles" }]
			: []),
		{ id: "exit", icon: "exit", text: "Salir de VR" },
	];
}
