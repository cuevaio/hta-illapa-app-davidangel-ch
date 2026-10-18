import GUI, { type Controller } from "lil-gui";
import type { WallMaterial } from "../../edit/commands";
import type { QualityProfileId } from "../../platform/quality";
import type { PngDemOptions } from "../../scenario/dem";
import type { RheologyModel } from "../../solver/Solver";
import {
	type AppState,
	type ColorMode,
	type ToolId,
	WALL_DEFAULTS,
} from "../../state/appState";
import type { Store } from "../../state/store";
import { panelSections } from "../sections";

export interface PanelActions {
	resetSimulation(): void;
	undo(): void;
	redo(): void;
	loadDem(file: File, kind: "geotiff" | "png16", png: PngDemOptions): void;
	useSyntheticTerrain(): void;
	exportScenario(): void;
	importScenario(file: File): void;
}

/** Flat mirror of the store fields lil-gui edits. */
interface Mirror {
	speed: number;
	rheology: RheologyModel;
	mu: number;
	xi: number;
	yieldStress: number;
	viscosity: number;
	flowIndex: number;
	density: number;
	volume: number;
	peakDischarge: number;
	radius: number;
	enabled: boolean;
	colorMode: ColorMode;
	contours: boolean;
	depthScale: number;
	speedScale: number;
	profile: QualityProfileId;
	auto: boolean;
	tool: ToolId;
	wallMaterial: WallMaterial;
	halfWidth: number;
	wallHeight: number;
	maxFlowDepth: number;
}

function mirrorOf(s: AppState): Mirror {
	return {
		speed: s.playback.speed,
		...s.material,
		volume: s.emitter.volume,
		peakDischarge: s.emitter.peakDischarge,
		radius: s.emitter.radius,
		enabled: s.emitter.enabled,
		...s.view,
		profile: s.quality.profile,
		auto: s.quality.auto,
		tool: s.tool,
		wallMaterial: s.wall.material,
		halfWidth: s.wall.halfWidth,
		wallHeight: s.wall.height,
		maxFlowDepth: s.wall.maxFlowDepth,
	};
}

/**
 * HTML parameter panel. It only reads and writes the shared store, so the VR
 * panel (Phase 3) stays in sync by construction.
 */
export class ControlPanel {
	readonly gui: GUI;
	private readonly store: Store<AppState>;
	private readonly m: Mirror;
	private readonly playCtrl: Controller;
	private toolSections: (tool: ToolId) => void = () => {};
	private readonly rheologyDeps: {
		voellmy: Controller[];
		hb: Controller[];
		hbOnly: Controller[];
	};

	constructor(
		container: HTMLElement,
		store: Store<AppState>,
		actions: PanelActions,
		opts: { qualityEditable: boolean },
	) {
		this.store = store;
		this.m = mirrorOf(store.get());
		const m = this.m;
		this.gui = new GUI({
			container,
			title: "Parámetros",
			width: 320,
		});
		const gui = this.gui;
		if (window.matchMedia("(max-width: 700px)").matches) gui.close();

		const sim = gui.addFolder("Simulación");
		const playBtn = {
			toggle: () =>
				store.set((s) => ({
					playback: { ...s.playback, playing: !s.playback.playing },
				})),
		};
		this.playCtrl = sim.add(playBtn, "toggle");
		sim
			.add({ reset: () => actions.resetSimulation() }, "reset")
			.name("Reiniciar escenario (R)");
		sim
			.add(m, "enabled")
			.name("Orígenes activos (todos)")
			.onChange(() =>
				store.set((s) => ({ emitter: { ...s.emitter, enabled: m.enabled } })),
			);
		sim
			.add(m, "speed", 1, 60, 1)
			.name("Velocidad (× tiempo real)")
			.onChange((v: number) =>
				store.set((s) => ({ playback: { ...s.playback, speed: v } })),
			);

		const ed = gui.addFolder("Edición del terreno");
		ed.add(m, "tool", {
			"Navegar (N)": "navigate",
			"Colocar origen (O)": "source",
			"Dibujar muro (M)": "wall",
			"Borrar (B)": "erase",
		})
			.name("Herramienta")
			.onChange(() => store.set({ tool: m.tool }));
		const setWall = () =>
			store.set({
				wall: {
					material: m.wallMaterial,
					halfWidth: m.halfWidth,
					height: m.wallHeight,
					maxFlowDepth: m.maxFlowDepth,
				},
			});
		// Options of the active tool only (same rule as the 3D panel).
		const hint = document.createElement("p");
		hint.className = "panel-hint";
		ed.$children.append(hint);
		const halfWidthCtrl = ed
			.add(m, "halfWidth", 0.5, 40, 0.5)
			.name("Muro: semiespesor (m)")
			.onChange(setWall);
		const heightCtrl = ed
			.add(m, "wallHeight", 1, 30, 0.5)
			.name("Muro: altura (m)")
			.onChange(setWall);
		const materialCtrl = ed
			.add(m, "wallMaterial", {
				"Berma de tierra": "earth",
				"Muro de concreto": "concrete",
			})
			.name("Tipo de barrera")
			.onChange(() => {
				m.halfWidth = WALL_DEFAULTS[m.wallMaterial].halfWidth;
				m.wallHeight = WALL_DEFAULTS[m.wallMaterial].height;
				halfWidthCtrl.updateDisplay();
				heightCtrl.updateDisplay();
				setWall();
			});
		const thresholdCtrl = ed
			.add(m, "maxFlowDepth", 0, 5, 0.05)
			.name("Umbral h para muros (m)")
			.onChange(setWall);
		const setEm = () =>
			store.set((s) => ({
				emitter: {
					...s.emitter,
					volume: m.volume,
					peakDischarge: m.peakDischarge,
					radius: m.radius,
					enabled: m.enabled,
				},
			}));
		const sourceCtrls = [
			ed
				.add(m, "volume", 1000, 500_000, 1000)
				.name("Volumen de los nuevos (m³)")
				.onChange(setEm),
			ed
				.add(m, "peakDischarge", 10, 2000, 10)
				.name("Caudal pico de los nuevos (m³/s)")
				.onChange(setEm),
			ed
				.add(m, "radius", 5, 100, 1)
				.name("Radio de los nuevos (m)")
				.onChange(setEm),
		];
		const wallCtrls = [halfWidthCtrl, heightCtrl, materialCtrl, thresholdCtrl];
		this.toolSections = (tool) => {
			const sec = panelSections({ tool, mode: "maquette", input: "web" });
			wallCtrls.forEach((c) => {
				c.show(sec.wall);
			});
			sourceCtrls.forEach((c) => {
				c.show(sec.source);
			});
			hint.textContent = sec.hint ?? "";
			hint.hidden = sec.hint === null;
		};
		ed.add({ undo: () => actions.undo() }, "undo").name("Deshacer (Ctrl+Z)");
		ed.add({ redo: () => actions.redo() }, "redo").name("Rehacer (Ctrl+Y)");

		const mat = gui.addFolder("Material (reología)");
		const setMat = () =>
			store.set({
				material: {
					rheology: m.rheology,
					mu: m.mu,
					xi: m.xi,
					yieldStress: m.yieldStress,
					viscosity: m.viscosity,
					flowIndex: m.flowIndex,
					density: m.density,
				},
			});
		mat
			.add(m, "rheology", {
				"Voellmy (Coulomb + turbulento)": "voellmy",
				Bingham: "bingham",
				"Herschel-Bulkley": "herschel-bulkley",
			})
			.name("Modelo")
			.onChange(() => {
				setMat();
				this.updateRheologyVisibility();
			});
		const mu = mat
			.add(m, "mu", 0, 0.6, 0.005)
			.name("Fricción μ")
			.onChange(setMat);
		const xi = mat
			.add(m, "xi", 50, 2000, 10)
			.name("Coef. turbulento ξ (m/s²)")
			.onChange(setMat);
		const ys = mat
			.add(m, "yieldStress", 0, 10000, 50)
			.name("Límite de fluencia τy (Pa)")
			.onChange(setMat);
		const visc = mat
			.add(m, "viscosity", 1, 2000, 1)
			.name("Viscosidad / K (Pa·sⁿ)")
			.onChange(setMat);
		const fi = mat
			.add(m, "flowIndex", 0.2, 1.5, 0.05)
			.name("Índice de flujo n")
			.onChange(setMat);
		const rho = mat
			.add(m, "density", 1200, 2600, 10)
			.name("Densidad ρ (kg/m³)")
			.onChange(setMat);
		this.rheologyDeps = {
			voellmy: [mu, xi],
			hb: [ys, visc, rho],
			hbOnly: [fi],
		};

		const vis = gui.addFolder("Visualización");
		const setView = () =>
			store.set({
				view: {
					colorMode: m.colorMode,
					contours: m.contours,
					depthScale: m.depthScale,
					speedScale: m.speedScale,
				},
			});
		vis
			.add(m, "colorMode", { Profundidad: "depth", Velocidad: "speed" })
			.name("Colorear por")
			.onChange(setView);
		vis
			.add(m, "depthScale", 0.5, 20, 0.5)
			.name("Escala profundidad (m)")
			.onChange(setView);
		vis
			.add(m, "speedScale", 1, 40, 1)
			.name("Escala velocidad (m/s)")
			.onChange(setView);
		vis.add(m, "contours").name("Curvas de nivel").onChange(setView);

		const q = gui.addFolder("Calidad");
		q.add(m, "profile", {
			"Baja (128²)": "low",
			"Media (192²)": "medium",
			"Alta (256²)": "high",
			"Ultra (512²)": "ultra",
		})
			.name("Resolución del solver")
			.onChange(() =>
				store.set({ quality: { profile: m.profile, auto: m.auto } }),
			);
		q.add(m, "auto")
			.name("Degradación automática")
			.onChange(() =>
				store.set({ quality: { profile: m.profile, auto: m.auto } }),
			);
		if (!opts.qualityEditable) {
			q.controllers.forEach((c) => {
				c.disable();
			});
			q.title("Calidad (fija: solver CPU 128²)");
		}

		const ter = gui.addFolder("Terreno");
		const png: PngDemOptions = {
			cellSize: 8,
			minElevation: 0,
			maxElevation: 1000,
		};
		const pick = (kind: "geotiff" | "png16") => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = kind === "geotiff" ? ".tif,.tiff" : ".png";
			input.onchange = () =>
				input.files?.[0] && actions.loadDem(input.files[0], kind, { ...png });
			input.click();
		};
		ter
			.add({ geotiff: () => pick("geotiff") }, "geotiff")
			.name("Cargar DEM GeoTIFF…");
		ter.add(png, "cellSize", 0.5, 100, 0.5).name("PNG: tamaño de celda (m)");
		ter.add(png, "minElevation").name("PNG: cota mínima (m)");
		ter.add(png, "maxElevation").name("PNG: cota máxima (m)");
		ter
			.add({ png: () => pick("png16") }, "png")
			.name("Cargar DEM PNG 16 bits…");
		ter
			.add({ synth: () => actions.useSyntheticTerrain() }, "synth")
			.name("Usar quebrada sintética");
		ter.close();

		const sc = gui.addFolder("Escenario");
		sc.add({ exp: () => actions.exportScenario() }, "exp").name(
			"Exportar escenario (JSON)",
		);
		sc.add(
			{
				imp: () => {
					const input = document.createElement("input");
					input.type = "file";
					input.accept = ".json,application/json";
					input.onchange = () =>
						input.files?.[0] && actions.importScenario(input.files[0]);
					input.click();
				},
			},
			"imp",
		).name("Importar escenario (JSON)…");
		sc.close();

		this.updateRheologyVisibility();
		this.syncFromStore();
		store.subscribe(() => this.syncFromStore());
	}

	private updateRheologyVisibility(): void {
		const voellmy = this.m.rheology === "voellmy";
		this.rheologyDeps.voellmy.forEach((c) => {
			c.show(voellmy);
		});
		this.rheologyDeps.hb.forEach((c) => {
			c.show(!voellmy);
		});
		this.rheologyDeps.hbOnly.forEach((c) => {
			c.show(this.m.rheology === "herschel-bulkley");
		});
	}

	/** Pulls store values into the panel (e.g. after the VR panel changed them). */
	syncFromStore(): void {
		const s = this.store.get();
		Object.assign(this.m, mirrorOf(s));
		this.playCtrl.name(
			s.playback.playing ? "⏸ Pausar (espacio)" : "▶ Reproducir (espacio)",
		);
		this.gui.controllersRecursive().forEach((c) => {
			c.updateDisplay();
		});
		this.updateRheologyVisibility();
		this.toolSections(s.tool);
	}
}
