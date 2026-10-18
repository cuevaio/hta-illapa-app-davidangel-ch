import { type Mesh, MeshBuilder, type Scene } from "@babylonjs/core";
import {
	AdvancedDynamicTexture,
	type Button,
	Control,
	Grid,
	Image,
	Slider,
	StackPanel,
	type TextBlock,
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
import { readVrTheme } from "./theme";
import {
	paintButton,
	themedButton,
	themedSurface,
	themedText,
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
}

const PANEL_W = 0.5;
const PANEL_H = 0.9;
const TEX_W = 1000;
const TEX_H = 1800;
/** The panel title, a size up from the web heading (it names the whole panel). */
const TITLE_PX = 44;
/** Weather page height (texture px): the panel minus its title, stats and footer rows. */
const WEATHER_PAGE_H_PX = 1450;

interface ButtonSpec {
	icon: IconName | ((s: AppState) => IconName);
	text: string;
	onClick: () => void;
	active?: (s: AppState) => boolean;
	disabled?: (s: AppState) => boolean;
}

/**
 * Floating 3D panel for XR: a mesh with a GUI texture, operated with the controller ray
 * (Babylon pointer selection). It reads and writes the same store as the HTML panel. Only the
 * options of the active tool and mode are shown; every action has an icon.
 */
export class VrPanel {
	readonly mesh: Mesh;
	private readonly ui: AdvancedDynamicTexture;
	private readonly stats: TextBlock;
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
			{ width: PANEL_W, height: PANEL_H, sideOrientation: 2 },
			scene,
		);
		this.mesh.isPickable = true;
		this.ui = AdvancedDynamicTexture.CreateForMesh(
			this.mesh,
			TEX_W,
			TEX_H,
			false,
		);
		themedSurface(this.ui, this.theme);

		const root = new StackPanel("root");
		root.width = "94%";
		root.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
		root.paddingTop = "20px";
		this.ui.addControl(root);

		root.addControl(
			themedText(this.theme, "heading", "Simulador de huaicos", TITLE_PX),
		);
		this.stats = themedText(this.theme, "data");
		this.stats.color = this.theme.inkMuted;
		this.stats.height = "90px";
		root.addControl(this.stats);

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
		const hint = themedText(this.theme, "body");
		hint.color = this.theme.inkMuted;
		hint.height = "96px";
		simulatorPage.addControl(hint);
		const sourceBox = this.section(simulatorPage);
		const sourceTitle = themedText(this.theme, "label", "Orígenes nuevos");
		sourceTitle.color = this.theme.action;
		sourceBox.addControl(sourceTitle);
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
				{ icon: "reset", text: "Reiniciar", onClick: actions.resetSimulation },
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
			? weatherScroller(this.theme, weatherSection, `${WEATHER_PAGE_H_PX}px`)
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
		// One row, so the panel keeps its height.
		root.addControl(
			this.row(
				"",
				panelFooter({
					backToMap: !!actions.backToMap,
					weather: weatherSection !== null,
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
									}
								: { icon: a.icon, text: a.text, onClick: actions.exitXr },
				),
			),
		);

		this.syncers.push((s) => {
			const sec = panelSections({ tool: s.tool, mode: s.xr.mode });
			sourceBox.isVisible = sec.source;
			wallBox.isVisible = sec.wall;
			maquetteBox.isVisible = sec.maquette;
			const inResult = s.result.mode === "result";
			liveRow.isVisible = !inResult;
			resultBox.isVisible = inResult;
			hint.isVisible = sec.hint !== null;
			hint.text = sec.hint ?? "";
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
		parent.addControl(box);
		return box;
	}

	/** A titled row of icon buttons. */
	private row(title: string, items: ButtonSpec[]): StackPanel {
		const box = new StackPanel();
		box.width = "100%";
		if (title) box.addControl(themedText(this.theme, "label", title));
		const grid = new Grid();
		grid.height = "112px";
		items.forEach(() => {
			grid.addColumnDefinition(1 / items.length);
		});
		items.forEach((it, k) => {
			grid.addControl(this.button(it, items.length >= 4 ? 26 : 30), 0, k);
		});
		box.addControl(grid);
		return box;
	}

	private button(it: ButtonSpec, fontSize: number): Button {
		const b = themedButton(this.theme);
		// Fixed grid inside the button: the icon cell has a bounded size and the label clips with an
		// ellipsis, so neither can overflow the button whatever the device font measures.
		const content = new Grid();
		const ICON = 56;
		if (it.text) {
			content.addColumnDefinition(ICON + 20, true);
			content.addColumnDefinition(1);
		} else {
			content.addColumnDefinition(1);
		}
		const img = new Image();
		img.width = `${ICON}px`;
		img.height = `${ICON}px`;
		img.stretch = Image.STRETCH_UNIFORM;
		img.horizontalAlignment = it.text
			? Control.HORIZONTAL_ALIGNMENT_RIGHT
			: Control.HORIZONTAL_ALIGNMENT_CENTER;
		content.addControl(img, 0, 0);
		let text: TextBlock | null = null;
		if (it.text) {
			text = themedText(this.theme, "button", it.text, fontSize);
			text.height = "100%";
			text.paddingLeft = "12px";
			text.paddingRight = "8px";
			text.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
			text.textWrapping = 2; // TextWrapping.Ellipsis (ambient const enum)
			content.addControl(text, 0, 1);
		}
		b.addControl(content);
		b.onPointerClickObservable.add(() => {
			if (b.isEnabled) it.onClick();
		});
		let lastSrc = "";
		this.syncers.push((s) => {
			lastSrc = paintButton(
				this.theme,
				{
					button: b,
					label: text,
					image: img,
					icon: typeof it.icon === "function" ? it.icon(s) : it.icon,
					source: lastSrc,
				},
				{
					active: it.active?.(s) ?? false,
					disabled: it.disabled?.(s) ?? false,
				},
			);
		});
		return b;
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
		const text = themedText(this.theme, "body");
		box.addControl(text);
		const sl = new Slider();
		sl.minimum = min;
		sl.maximum = max;
		sl.step = step;
		sl.height = "52px";
		sl.width = "92%";
		sl.color = this.theme.action;
		sl.background = this.theme.control;
		sl.thumbColor = this.theme.action;
		sl.thumbWidth = "44px";
		sl.isThumbCircle = true;
		sl.onValueChangedObservable.add((v) => {
			if (Math.abs(v - get(this.store.get())) > step / 2) set(v);
		});
		box.addControl(sl);
		this.syncers.push((s) => {
			const v = get(s);
			if (Math.abs(sl.value - v) > step / 2) sl.value = v;
			text.text = `${title}: ${fmt(v)}`;
		});
		return box;
	}

	/** Playhead slider; its range follows the recording. */
	private timeSlider(ra: ResultActions): StackPanel {
		const box = new StackPanel();
		box.width = "100%";
		const text = themedText(this.theme, "body");
		box.addControl(text);
		const sl = new Slider();
		sl.height = "52px";
		sl.width = "92%";
		sl.color = this.theme.action;
		sl.background = this.theme.control;
		sl.thumbColor = this.theme.action;
		sl.thumbWidth = "44px";
		sl.isThumbCircle = true;
		sl.onValueChangedObservable.add((v) => {
			if (Math.abs(v - this.store.get().result.time) > 0.5) ra.seek(v);
		});
		box.addControl(sl);
		this.syncers.push((s) => {
			const r = s.result;
			sl.minimum = r.start;
			sl.maximum = Math.max(r.end, r.start + 1);
			if (Math.abs(sl.value - r.time) > 0.5) sl.value = r.time;
			text.text = `Tiempo: ${r.time.toFixed(0)} / ${r.end.toFixed(0)} s (${r.frames} fotogramas)`;
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
