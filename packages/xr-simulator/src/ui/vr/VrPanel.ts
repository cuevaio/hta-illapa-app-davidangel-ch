import { type Mesh, MeshBuilder, type Scene } from "@babylonjs/core";
import {
	AdvancedDynamicTexture,
	type Control,
	StackPanel,
} from "@babylonjs/gui";
import { redo as redoHistory, undo as undoHistory } from "../../edit/commands";
import type { ResultActions } from "../../playback/ResultActions";
import type { SolverStats } from "../../solver/Solver";
import {
	type AppState,
	type ToolId,
	WALL_DEFAULTS,
	type XrViewMode,
} from "../../state/appState";
import type { Store } from "../../state/store";
import type { IconName } from "../icons";
import {
	panelFooter,
	panelSections,
	type WeatherMenuContent,
} from "../sections";
import {
	CARD_HEADER_GAP_CSS_PX,
	CONTROL_GAP_CSS_PX,
	metresOf,
	readVrTheme,
	texturePx,
} from "./theme";
import {
	type MayuControlKind,
	MayuText,
	mayuCard,
	mayuControl,
	mayuLabel,
	mayuRow,
	mayuSlider,
} from "./themeGui";
import { VrWeatherSection, weatherScroller } from "./VrWeatherMenu";

export interface VrPanelActions {
	resetSimulation(): void;
	exitXr(): void;
	result: ResultActions;
	/** "Volver al mapa del Perú" (S2), VR sessions only; absent: no such button. */
	backToMap?: () => void;
	/** Whether the map can be shown right now (its relief loaded). */
	mapAvailable?: () => boolean;
	/** The weather menu page (S8); absent: no "Meteorología" button. */
	weather?: {
		content(): WeatherMenuContent | null;
		action(id: string): void;
	};
	/** «Controles»: reopens the VR controls instructions (S15); absent: no such button. */
	showControls?: () => void;
}

/** Panel size in web CSS px (a phone-wide card); the card hugs its content from the top. */
const PANEL_CSS_W = 400;
const PANEL_CSS_H = 880;
/** Weather page: the panel minus the card header, footer and spacing. */
const WEATHER_PAGE_CSS_H = 660;

interface ButtonSpec {
	icon: IconName | ((s: AppState) => IconName);
	text: string;
	onClick: () => void;
	active?: (s: AppState) => boolean;
	disabled?: (s: AppState) => boolean;
	/** Share of the row (default 1). */
	weight?: number;
	/** Default: a toggle when it has an on state (`active`), else a secondary button. */
	kind?: MayuControlKind;
}

/**
 * Floating 3D panel for XR: a mesh with a GUI texture, operated with the controller ray
 * (Babylon pointer selection). It reads and writes the same store as the HTML panel. Only the
 * options of the active tool and mode are shown; every action has an icon.
 */
export class VrPanel {
	readonly mesh: Mesh;
	private readonly ui: AdvancedDynamicTexture;
	private readonly stats: MayuText;
	private readonly unsubscribe: () => void;
	private readonly syncers: ((s: AppState) => void)[] = [];
	private weatherShown = false;
	private readonly theme = readVrTheme();
	/** Re-reads the weather menu while its page is shown (called per frame by the controller). */
	readonly refreshWeather: () => void;

	constructor(
		scene: Scene,
		private readonly store: Store<AppState>,
		actions: VrPanelActions,
	) {
		this.mesh = MeshBuilder.CreatePlane(
			"vr-panel",
			{
				width: metresOf(PANEL_CSS_W),
				height: metresOf(PANEL_CSS_H),
				sideOrientation: 2,
			},
			scene,
		);
		this.mesh.isPickable = true;
		this.ui = AdvancedDynamicTexture.CreateForMesh(
			this.mesh,
			texturePx(PANEL_CSS_W),
			texturePx(PANEL_CSS_H),
			false,
		);
		const card = mayuCard(this.ui, this.theme, {
			title: "Simulador de huaicos",
			description: true,
			footer: true,
		});
		const root = card.content;
		this.stats = card.description ?? new MayuText(this.theme, "body");

		// Simulator controls, or the weather menu page (S8) instead of them.
		const simulatorPage = this.section(root);
		// Tools.
		const tool = (id: ToolId, icon: IconName, text: string): ButtonSpec => ({
			icon,
			text,
			active: (s) => s.tool === id,
			onClick: () => store.set({ tool: id }),
		});
		simulatorPage.addControl(
			this.row("Herramienta", [
				tool("navigate", "navigate", "Navegar"),
				tool("source", "source", "Origen"),
				tool("wall", "wall", "Muro"),
				tool("erase", "erase", "Borrar"),
			]),
		);

		// Options of the active tool.
		const hint = new MayuText(this.theme, "body");
		hint.color = this.theme.colors.mutedForeground;
		simulatorPage.addControl(hint);
		const sourceBox = this.section(simulatorPage);
		sourceBox.addControl(mayuLabel(this.theme, "Orígenes nuevos"));
		sourceBox.addControl(
			this.slider(
				"Volumen (m³)",
				1000,
				500_000,
				1000,
				(s) => s.emitter.volume,
				(v) => store.set((s) => ({ emitter: { ...s.emitter, volume: v } })),
				(v) => v.toFixed(0),
			),
		);
		sourceBox.addControl(
			this.slider(
				"Caudal pico (m³/s)",
				10,
				2000,
				10,
				(s) => s.emitter.peakDischarge,
				(v) =>
					store.set((s) => ({ emitter: { ...s.emitter, peakDischarge: v } })),
				(v) => v.toFixed(0),
			),
		);
		sourceBox.addControl(
			this.slider(
				"Radio (m)",
				5,
				100,
				1,
				(s) => s.emitter.radius,
				(v) => store.set((s) => ({ emitter: { ...s.emitter, radius: v } })),
				(v) => v.toFixed(0),
			),
		);
		const wallBox = this.section(simulatorPage);
		const material = (
			m: "earth" | "concrete",
			icon: IconName,
			text: string,
		): ButtonSpec => ({
			icon,
			text,
			active: (s) => s.wall.material === m,
			onClick: () =>
				store.set((s) => ({
					wall: { ...s.wall, material: m, ...WALL_DEFAULTS[m] },
				})),
		});
		wallBox.addControl(
			this.row("Tipo de barrera", [
				material("earth", "earth", "Berma de tierra"),
				material("concrete", "concrete", "Concreto"),
			]),
		);
		wallBox.addControl(
			this.slider(
				"Altura del muro (m)",
				1,
				30,
				0.5,
				(s) => s.wall.height,
				(v) => store.set((s) => ({ wall: { ...s.wall, height: v } })),
				(v) => v.toFixed(1),
			),
		);

		// Simulation.
		simulatorPage.addControl(
			this.row("Simulación", [
				{
					icon: (s) => (s.playback.playing ? "pause" : "play"),
					text: "",
					active: (s) => s.playback.playing,
					onClick: () =>
						store.set((s) => ({
							playback: { ...s.playback, playing: !s.playback.playing },
						})),
				},
				{
					icon: "reset",
					text: "Reiniciar",
					weight: 2,
					onClick: actions.resetSimulation,
					kind: { kind: "button", variant: "outline" },
				},
				{
					icon: "undo",
					text: "",
					onClick: () =>
						store.set((s) => ({ history: undoHistory(s.history) })),
					disabled: (s) => s.history.commands.length === 0,
				},
				{
					icon: "redo",
					text: "",
					onClick: () =>
						store.set((s) => ({ history: redoHistory(s.history) })),
					disabled: (s) => s.history.redo.length === 0,
				},
			]),
		);
		simulatorPage.addControl(
			this.slider(
				"Velocidad (× tiempo real)",
				1,
				60,
				1,
				(s) => s.playback.speed,
				(v) => store.set((s) => ({ playback: { ...s.playback, speed: v } })),
				(v) => v.toFixed(0),
			),
		);
		simulatorPage.addControl(
			this.slider(
				"Fricción μ",
				0.02,
				0.5,
				0.01,
				(s) => s.material.mu,
				(v) => store.set((s) => ({ material: { ...s.material, mu: v } })),
			),
		);

		// Recording and result mode (same actions as the web timeline).
		const ra = actions.result;
		const liveRow = this.row("Resultado", [
			{
				icon: (s) => (s.result.recording ? "stop" : "record"),
				text: "",
				active: (s) => s.result.recording,
				onClick: () => ra.toggleRecording(),
			},
			{
				icon: "result",
				text: "Ver resultado",
				onClick: () => ra.setResultMode(true),
				disabled: (s) => s.result.frames < 2,
			},
		]);
		simulatorPage.addControl(liveRow);
		const resultBox = this.section(simulatorPage);
		resultBox.addControl(
			this.row("Resultado", [
				{ icon: "stepBack", text: "", onClick: () => ra.step(-1) },
				{
					icon: (s) => (s.result.playing ? "pause" : "play"),
					text: "",
					active: (s) => s.result.playing,
					onClick: () => ra.togglePlay(),
				},
				{ icon: "stepForward", text: "", onClick: () => ra.step(1) },
				{ icon: "live", text: "Vivo", onClick: () => ra.setResultMode(false) },
			]),
		);
		resultBox.addControl(this.timeSlider(ra));

		// View.
		const mode = (m: XrViewMode, icon: IconName, text: string): ButtonSpec => ({
			icon,
			text,
			active: (s) => s.xr.mode === m,
			onClick: () => store.set((s) => ({ xr: { ...s.xr, mode: m } })),
		});
		simulatorPage.addControl(
			this.row("Vista", [
				mode("maquette", "maquette", "Maqueta"),
				mode("immersive", "immersive", "Inmersivo"),
			]),
		);
		const maquetteBox = this.section(simulatorPage);
		maquetteBox.addControl(
			this.slider(
				"Tamaño de la maqueta (m)",
				0.2,
				6,
				0.1,
				(s) => s.xr.tableSize,
				(v) => store.set((s) => ({ xr: { ...s.xr, tableSize: v } })),
				(v) => v.toFixed(1),
			),
		);
		maquetteBox.addControl(
			this.slider(
				"Ajuste a cuadrícula (m, 0 = no)",
				0,
				50,
				5,
				(s) => s.xr.snap,
				(v) => store.set((s) => ({ xr: { ...s.xr, snap: v } })),
				(v) => v.toFixed(0),
			),
		);
		maquetteBox.addControl(
			this.slider(
				"Suavizado del rayo",
				0,
				0.9,
				0.05,
				(s) => s.xr.smoothing,
				(v) => store.set((s) => ({ xr: { ...s.xr, smoothing: v } })),
			),
		);

		const weatherContent = actions.weather?.content();
		const weatherSection =
			actions.weather && weatherContent
				? new VrWeatherSection(
						this.theme,
						weatherContent,
						actions.weather.action,
					)
				: null;
		const weatherPage = weatherSection
			? weatherScroller(
					this.theme,
					weatherSection,
					`${texturePx(WEATHER_PAGE_CSS_H)}px`,
				)
			: null;
		if (weatherPage) {
			weatherPage.isVisible = false;
			root.addControl(weatherPage);
		}
		const showWeather = (shown: boolean) => {
			this.weatherShown = shown;
			simulatorPage.isVisible = !shown;
			if (weatherPage) weatherPage.isVisible = shown;
			this.refresh();
		};
		this.refreshWeather = () => {
			const content = actions.weather?.content();
			if (this.weatherShown && content) weatherSection?.update(content);
		};

		// Footer: "Volver al mapa del Perú" (staying in VR) when offered, then "Salir de VR".
		const footerSpecs = panelFooter({
			backToMap: Boolean(actions.backToMap),
			weather: weatherSection !== null,
			controls: Boolean(actions.showControls),
		}).map(
			(a): ButtonSpec =>
				a.id === "weather"
					? {
							icon: a.icon,
							text: a.text,
							onClick: () => showWeather(!this.weatherShown),
							active: () => this.weatherShown,
						}
					: a.id === "backToMap"
						? {
								icon: a.icon,
								text: a.text,
								onClick: () => actions.backToMap?.(),
								disabled: () => !(actions.mapAvailable?.() ?? true),
								// The panel's one primary action: back to the map, staying in VR.
								kind: { kind: "button", variant: "default" },
							}
						: {
								icon: a.icon,
								text: a.text,
								onClick:
									a.id === "controls"
										? () => actions.showControls?.()
										: actions.exitXr,
								kind: { kind: "button", variant: "outline" },
							},
		);
		// The primary action gets its own full-width row, the others share the next one.
		const primary = footerSpecs.filter(
			(spec) => spec.kind?.kind === "button" && spec.kind.variant === "default",
		);
		const others = footerSpecs.filter((spec) => !primary.includes(spec));
		if (primary.length) card.footer?.addControl(this.row("", primary));
		card.footer?.addControl(this.row("", others));

		this.syncers.push((s) => {
			const sec = panelSections({ tool: s.tool, mode: s.xr.mode });
			sourceBox.isVisible = sec.source;
			wallBox.isVisible = sec.wall;
			maquetteBox.isVisible = sec.maquette;
			const inResult = s.result.mode === "result";
			liveRow.isVisible = !inResult;
			resultBox.isVisible = inResult;
			hint.isVisible = sec.hint !== null;
			hint.show(sec.hint ?? "");
		});
		const sync = (s: AppState) =>
			this.syncers.forEach((f) => {
				f(s);
			});
		sync(store.get());
		this.unsubscribe = store.subscribe(sync);
	}

	private refresh(): void {
		for (const syncer of this.syncers) syncer(this.store.get());
	}

	private section(parent: StackPanel): StackPanel {
		const box = new StackPanel();
		box.width = "100%";
		box.spacing = texturePx(CONTROL_GAP_CSS_PX);
		parent.addControl(box);
		return box;
	}

	/** A titled row of controls. */
	private row(title: string, items: ButtonSpec[]): StackPanel {
		const box = new StackPanel();
		box.width = "100%";
		box.spacing = texturePx(CARD_HEADER_GAP_CSS_PX);
		if (title) box.addControl(mayuLabel(this.theme, title));
		box.addControl(
			mayuRow(
				items.map((item) => this.button(item)),
				items.map((item) => item.weight ?? 1),
			),
		);
		return box;
	}

	private button(it: ButtonSpec): Control {
		const kind: MayuControlKind =
			it.kind ??
			(it.active
				? { kind: "toggle" }
				: { kind: "button", variant: "secondary" });
		const control = mayuControl(
			this.theme,
			kind,
			{
				icon:
					typeof it.icon === "function" ? it.icon(this.store.get()) : it.icon,
				text: it.text,
			},
			it.onClick,
		);
		this.syncers.push((s) => {
			if (typeof it.icon === "function") control.setIcon(it.icon(s));
			control.set({
				on: it.active?.(s) ?? false,
				disabled: it.disabled?.(s) ?? false,
			});
		});
		return control.button;
	}

	private slider(
		title: string,
		min: number,
		max: number,
		step: number,
		get: (s: AppState) => number,
		set: (v: number) => void,
		fmt = (v: number) => v.toFixed(2),
	): StackPanel {
		const box = new StackPanel();
		box.width = "100%";
		const text = new MayuText(this.theme, "body");
		box.addControl(text);
		const sl = mayuSlider(this.theme);
		sl.minimum = min;
		sl.maximum = max;
		sl.step = step;
		sl.onValueChangedObservable.add((v) => {
			if (Math.abs(v - get(this.store.get())) > step / 2) set(v);
		});
		box.addControl(sl);
		this.syncers.push((s) => {
			const v = get(s);
			if (Math.abs(sl.value - v) > step / 2) sl.value = v;
			text.show(`${title}: ${fmt(v)}`);
		});
		return box;
	}

	/** Playhead slider; its range follows the recording. */
	private timeSlider(ra: ResultActions): StackPanel {
		const box = new StackPanel();
		box.width = "100%";
		const text = new MayuText(this.theme, "body");
		box.addControl(text);
		const sl = mayuSlider(this.theme);
		sl.onValueChangedObservable.add((v) => {
			if (Math.abs(v - this.store.get().result.time) > 0.5) ra.seek(v);
		});
		box.addControl(sl);
		this.syncers.push((s) => {
			const r = s.result;
			sl.minimum = r.start;
			sl.maximum = Math.max(r.end, r.start + 1);
			if (Math.abs(sl.value - r.time) > 0.5) sl.value = r.time;
			text.show(
				`Tiempo: ${r.time.toFixed(0)} / ${r.end.toFixed(0)} s (${r.frames} fotogramas)`,
			);
		});
		return box;
	}

	setStats(s: SolverStats, massError: number): void {
		this.stats.text =
			`t = ${s.simTime.toFixed(0)} s · volumen ${s.volume.toFixed(0)} m³\n` +
			`error de masa ${(massError * 100).toExponential(1)} % · h máx ${s.maxDepth.toFixed(2)} m`;
	}

	dispose(): void {
		this.unsubscribe();
		this.ui.dispose();
		this.mesh.dispose();
	}
}
