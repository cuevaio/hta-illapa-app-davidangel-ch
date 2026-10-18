import {
	type AbstractEngine,
	ArcRotateCamera,
	type Camera,
	Color3,
	Color4,
	Matrix,
	type Mesh,
	MeshBuilder,
	PointerEventTypes,
	Scene,
	StandardMaterial,
	TransformNode,
	Vector3,
} from "@babylonjs/core";
import {
	type WeatherMenuContent,
	weatherMenuAction,
	weatherMenuContent,
} from "../ui/sections";
import { ImageryToggle } from "../ui/web/ImageryToggle";
import { WeatherPanel } from "../ui/web/WeatherPanel";
import { FOG_DENSITY_PER_KM, FOG_UPDATE_RATIO } from "./constants";
import {
	type Bounds,
	easeInOut,
	FLY,
	OVERVIEW_VIEW,
	topDownView,
	type Vec3,
	vrStartPose,
	ZOOM,
	ZoomTween,
	zoomTarget,
} from "./flight";
import { fogDensityAt } from "./fog";
import {
	IMAGERY_HINTS,
	type ImageryAvailability,
	type ImageryMode,
} from "./imagery/imagerySource";
import { LodTerrain, viewOf } from "./lod/LodTerrain";
import { LOD_PROFILES, type LodProfile } from "./lod/lodProfile";
import {
	localToLonLat,
	localToWorld,
	peruFrame,
	worldToLocal,
} from "./lod/quadtree";
import { raycastGround } from "./lod/raycast";
import { OverviewFly } from "./OverviewFly";
import {
	activeSiteMarker,
	EXAGGERATION,
	exaggerationLabel,
	overviewButtons,
	pointLabel,
	skipLabel,
} from "./overviewState";
import { lonLatToWorld, PERU_BBOX } from "./tileMath";
import {
	attributionFrom,
	DEFAULT_ATTRIBUTION,
	type TilesClient,
} from "./tilesClient";
import { viewFocus } from "./weather/region";
import type { WeatherController } from "./weather/WeatherController";
import type {
	CloudSheet,
	WeatherFocus,
	WeatherGpu,
} from "./weather/WeatherGpu";

/** Weather layers (S8): one controller and GPU side for the whole app, shared with the map context. */
export interface OverviewWeather {
	controller: WeatherController;
	gpu: WeatherGpu;
}

/** Satellite imagery wiring (S7): the mode is shared with the simulator's map context by the app. */
export interface OverviewImagery {
	availability: ImageryAvailability;
	mode: ImageryMode;
	onChange(mode: ImageryMode): void;
}

const NO_IMAGERY: OverviewImagery = {
	availability: {
		available: false,
		provider: "none",
		hint: IMAGERY_HINTS.none,
	},
	mode: "relief",
	onChange: () => {},
};

export interface PickedPoint {
	lon: number;
	lat: number;
	/** Elevation (m) from the finest loaded overview tile (sea and nodata read 0 m); null if unknown. */
	height: number | null;
}

/** The simulation the simulator holds when it came from "Simular aquí" (S1). */
export interface ActiveSimulation {
	lon: number;
	lat: number;
	/** Elevation (m) at the site, for the marker; null if unknown. */
	height: number | null;
	/** Patch side (m). */
	size: number;
	label: string;
}

export interface OverviewActions {
	/** Loads the real terrain around the point into the simulator. */
	simulateHere(p: PickedPoint): Promise<void>;
	/** Goes to the simulator keeping its current terrain. */
	openSimulator(): void;
	/** "Volver al mapa del Perú" from the simulator. */
	backToMap(): void;
}

/** Hillshade slope exaggeration (as the former static z6 overview): real slopes look flat from afar. */
const HILLSHADE_Z = 5;
const FOG_COLOR = new Color3(0.62, 0.7, 0.78);
const HUD_INTERVAL_MS = 250;
/** Closest orbit distance (scene km); was 30 before the satellite imagery. */
const ORBIT_MIN_RADIUS = 2;
/** Farthest orbit zoom-out (km), raised when a narrow viewport needs more to frame Peru. */
const ORBIT_MAX_RADIUS = 6000;
/** Orbit near plane: radius / ORBIT_NEAR_RATIO, between 0.05 and 1 km (depth precision far away). */
const ORBIT_NEAR_RATIO = 40;

/** Farthest pick distance (scene km). */
const PICK_DISTANCE = 20_000;

export type CameraMode = "orbit" | "fly";

/** What the Quest/WebXR flight needs from the overview (src/xr/OverviewXr.ts). */
export interface FlightHost {
	readonly scene: Scene;
	/** Eye position and heading of the current web camera, where the VR flight starts. */
	eye(): { position: Vec3; yaw: number };
	/** Where the VR flight starts: middle of the map, facing north, above the highest relief. */
	vrStart(): { position: Vec3; yaw: number };
	/** Exaggerated ground height (scene km) under (x, z). */
	groundAt(x: number, z: number): number;
	bounds(): Bounds;
	/** First relief point along a world ray (scene km), without marking anything; null on a miss. */
	hitRay(origin: Vec3, direction: Vec3): Vec3 | null;
	/** Picks the relief along a world ray (marks the point for "Simular aquí"); true on a hit. */
	pickRay(origin: Vec3, direction: Vec3): boolean;
	/**
	 * VR started/ended: the DOM overlay hides and the web camera state is restored on exit.
	 * `eyePixelHeight` (eye buffer height) sets the LOD screen-space error in VR.
	 */
	vrChanged(inVr: boolean, eyePixelHeight?: number): void;
	/** Imagery attribution (and prototype notice) while Satélite is visible, for the VR card; else null. */
	imageryCredit(): { text: string; notice: string | null } | null;
	/** Weather section of the VR card at the marked point (S8); null without weather. */
	/** The VR weather menu (S8), null without a weather client. */
	weatherMenu(): WeatherMenuContent | null;
	/** A button of the VR weather menu (weatherMenuAction ids). */
	weatherAction(id: string): void;
	/** Attribution of the enabled weather layers (VR label); null when none is on. */
	weatherCredit(): string | null;
	/** The point marked for "Simular aquí" (web click or VR A button); null when none. */
	picked(): PickedPoint | null;
	/** "Cancelar" on the VR card: forgets the marked point. */
	clearPick(): void;
	/** The viewer's other simulators, offered on the VR card too (S5). */
	entries(): { id: string; label: string }[];
	/** Opens one of them at its own origin; resolves with the error text, or null on success. */
	openEntry(id: string): Promise<string | null>;
	/** Runs the web "Simular aquí" flow on the marked point; resolves with the error text, or null on success. */
	simulatePicked(): Promise<string | null>;
	/**
	 * VR maquette (S2): places the map root (local km → XR metres); null puts it back at
	 * identity (web and flight). Rays of hitRay/pickRay are world rays either way.
	 */
	setMapPlacement(
		t: { scaling: Vec3; yaw: number; position: Vec3 } | null,
	): void;
}

/**
 * "Vista general": the whole of Peru in relief from coarse tiles of our API, in its own
 * Babylon scene (units: km, x east, z north). Web only; the simulator does not run meanwhile.
 */
export class PeruOverview implements FlightHost {
	readonly scene: Scene;
	private readonly camera: ArcRotateCamera;
	private readonly fly: OverviewFly;
	private mode: CameraMode = "orbit";
	private terrain: LodTerrain | null = null;
	/** Follows the view distance (S11), shared by the scene fog and the relief shader. */
	private fogDensity = FOG_DENSITY_PER_KM;
	private readonly frame = peruFrame();
	private localBounds: Bounds;
	/** The Peru bbox itself (no flight margin), framed top-down by the web overview (S7). */
	private readonly peruBounds: Bounds;
	private xrEyePixels = 1680;
	private lastHud = 0;
	private inVr = false;
	private saved: {
		mode: CameraMode;
		alpha: number;
		beta: number;
		radius: number;
		target: Vector3;
		flyPos: Vector3;
		flyRot: Vector3;
	} | null = null;
	private vrHandler: (() => Promise<void>) | null = null;
	/** Parent of the relief tiles and markers: identity on the web and in VR flight, the table in VR maquette. */
	private readonly mapRoot: TransformNode;
	private mapPlaced = false;
	private readonly marker: Mesh;
	private readonly siteBeacon: Mesh;
	private readonly siteFootprint: Mesh;
	private activeSim: ActiveSimulation | null = null;
	private exaggeration: number = EXAGGERATION.default;
	private simulatorReady = false;
	/** Web double-click zoom in progress (orbit: target + radius; fly: eye). */
	private orbitZoom: {
		from: Vector3;
		to: Vector3;
		r0: number;
		r1: number;
		t: number;
	} | null = null;
	private flyZoom: ZoomTween | null = null;
	private pickedPoint: PickedPoint | null = null;
	private busy = false;
	private loaded = false;
	active = false;

	private readonly overlay: HTMLElement;
	private readonly status: HTMLElement;
	private readonly pickInfo: HTMLElement;
	private readonly simulateBtn: HTMLButtonElement;
	private readonly skipBtn: HTMLButtonElement;
	private readonly attribution: HTMLElement;
	private readonly backBtn: HTMLButtonElement;
	private readonly modeBtns: HTMLButtonElement[];
	private readonly flyHint: HTMLElement;
	private readonly flyPad: HTMLElement;
	private readonly vrBtn: HTMLButtonElement;
	private readonly entryBtns: HTMLButtonElement[] = [];
	private readonly entryOpeners = new Map<
		string,
		{ label: string; open: () => Promise<void> }
	>();
	private readonly lodInfo: HTMLElement;
	private readonly imageryToggle: ImageryToggle;
	private readonly weatherPanel: WeatherPanel | null = null;
	private readonly cloudSheet: CloudSheet | null = null;

	constructor(
		engine: AbstractEngine,
		private readonly canvas: HTMLCanvasElement,
		container: HTMLElement,
		private readonly actions: OverviewActions,
		private readonly profile: LodProfile = LOD_PROFILES.desktop,
		private readonly imagery: OverviewImagery = NO_IMAGERY,
		private readonly weather: OverviewWeather | null = null,
	) {
		this.scene = new Scene(engine);
		this.scene.clearColor = new Color4(
			FOG_COLOR.r,
			FOG_COLOR.g,
			FOG_COLOR.b,
			1,
		);
		this.scene.fogMode = Scene.FOGMODE_EXP2;
		this.scene.fogDensity = this.fogDensity;
		this.scene.fogColor = FOG_COLOR;
		const sw = lonLatToWorld(PERU_BBOX.west, PERU_BBOX.south);
		const ne = lonLatToWorld(PERU_BBOX.east, PERU_BBOX.north);
		const [minX, minZ] = worldToLocal(this.frame, sw.x, sw.y);
		const [maxX, maxZ] = worldToLocal(this.frame, ne.x, ne.y);
		this.peruBounds = { minX, maxX, minZ, maxZ };
		this.localBounds = {
			minX: minX - FLY.boundsMargin,
			maxX: maxX + FLY.boundsMargin,
			minZ: minZ - FLY.boundsMargin,
			maxZ: maxZ + FLY.boundsMargin,
		};

		// Framed top-down by frameTopDown() once the engine knows the viewport.
		this.camera = new ArcRotateCamera(
			"peru-orbit",
			-Math.PI / 2,
			OVERVIEW_VIEW.topDownBeta,
			ORBIT_MAX_RADIUS,
			Vector3.Zero(),
			this.scene,
		);
		this.camera.wheelDeltaPercentage = 0.02;
		this.camera.pinchDeltaPercentage = 0.004;
		this.camera.useNaturalPinchZoom = true;
		this.camera.upperBetaLimit = 1.4;
		// Close enough to read streets and houses on the satellite imagery (S7); the near plane follows the radius.
		this.camera.lowerRadiusLimit = ORBIT_MIN_RADIUS;
		this.camera.lowerBetaLimit = OVERVIEW_VIEW.topDownBeta;
		this.camera.upperRadiusLimit = ORBIT_MAX_RADIUS;
		this.camera.panningSensibility = 2;
		this.camera.minZ = 1;
		this.camera.maxZ = 20_000;
		this.camera.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");

		this.mapRoot = new TransformNode("peru-map-root", this.scene);
		this.marker = MeshBuilder.CreateCylinder(
			"peru-marker",
			{ height: 1, diameterTop: 10, diameterBottom: 0.5, tessellation: 24 },
			this.scene,
		);
		const mm = new StandardMaterial("peru-marker-mat", this.scene);
		mm.emissiveColor = new Color3(1, 0.45, 0.1);
		mm.disableLighting = true;
		this.marker.material = mm;
		this.marker.isPickable = false;
		this.marker.setEnabled(false);

		// Where the active simulation is: a cyan beacon over its square footprint.
		const sm = new StandardMaterial("peru-site-mat", this.scene);
		sm.emissiveColor = new Color3(0.2, 0.85, 1);
		sm.disableLighting = true;
		this.siteBeacon = MeshBuilder.CreateCylinder(
			"peru-site-beacon",
			{ height: 1, diameter: 3, tessellation: 16 },
			this.scene,
		);
		this.siteFootprint = MeshBuilder.CreateBox(
			"peru-site-footprint",
			{ size: 1 },
			this.scene,
		);
		const fm = sm.clone("peru-site-footprint-mat");
		fm.alpha = 0.55;
		this.siteBeacon.material = sm;
		this.siteFootprint.material = fm;
		for (const m of [this.marker, this.siteBeacon, this.siteFootprint])
			m.parent = this.mapRoot;
		for (const m of [this.siteBeacon, this.siteFootprint]) {
			m.isPickable = false;
			m.setEnabled(false);
		}

		this.scene.onPointerObservable.add((info) => {
			if (!this.active || this.inVr) return;
			if (info.type === PointerEventTypes.POINTERTAP)
				this.pickAt(this.scene.pointerX, this.scene.pointerY);
			else if (info.type === PointerEventTypes.POINTERDOUBLETAP)
				this.zoomAt(this.scene.pointerX, this.scene.pointerY);
			// Any new drag or wheel takes over from a running zoom.
			else if (
				info.type === PointerEventTypes.POINTERDOWN ||
				info.type === PointerEventTypes.POINTERWHEEL
			)
				this.orbitZoom = null;
		});
		this.fly = new OverviewFly(this.scene, canvas, {
			groundAt: (x, z) => this.groundAt(x, z),
			bounds: () => this.localBounds,
		});

		this.overlay = document.createElement("section");
		this.overlay.className = "peru-overlay";
		this.overlay.setAttribute("aria-label", "Mapa del Perú");
		this.overlay.innerHTML = `
      <h2>Perú en relieve</h2>
      <p class="peru-status" aria-live="polite">Cargando el mapa del Perú…</p>
      <div class="peru-mode" role="group" aria-label="Modo de cámara">
        <button type="button" data-mode="orbit" aria-pressed="true">Órbita</button>
        <button type="button" data-mode="fly" aria-pressed="false">Vuelo libre</button>
      </div>
      <p class="peru-fly-hint" hidden>W A S D: moverse · Q / E: bajar / subir · Shift: turbo · arrastra para mirar</p>
      <label class="peru-exag">Exageración vertical <input type="range" min="${EXAGGERATION.min}" max="${EXAGGERATION.max}" step="${EXAGGERATION.step}" value="${EXAGGERATION.default}"> <output>${exaggerationLabel(EXAGGERATION.default)}</output></label>
      <p class="peru-pick">Toca o haz clic en el mapa para elegir un punto; doble clic para acercarte.</p>
      <div class="peru-actions">
        <button type="button" class="peru-simulate" disabled>Simular aquí</button>
        <button type="button" class="peru-skip" disabled title="Preparando el simulador…">Ir al simulador</button>
        <button type="button" class="peru-vr" hidden>Entrar en VR</button>
      </div>
      <p class="peru-lod" aria-hidden="true"></p>
      <p class="peru-attribution"></p>`;
		this.status = this.overlay.querySelector(".peru-status")!;
		this.pickInfo = this.overlay.querySelector(".peru-pick")!;
		this.simulateBtn = this.overlay.querySelector(".peru-simulate")!;
		this.attribution = this.overlay.querySelector(".peru-attribution")!;
		this.lodInfo = this.overlay.querySelector(".peru-lod")!;
		this.attribution.textContent = DEFAULT_ATTRIBUTION;
		const slider = this.overlay.querySelector("input")!;
		const out = this.overlay.querySelector("output")!;
		slider.oninput = () => {
			this.setExaggeration(Number(slider.value));
			out.textContent = exaggerationLabel(Number(slider.value));
		};
		this.simulateBtn.onclick = () => void this.simulate();
		this.skipBtn = this.overlay.querySelector(".peru-skip")!;
		this.skipBtn.onclick = () => {
			if (overviewButtons(this.buttonState()).skip)
				this.actions.openSimulator();
		};
		this.modeBtns = [
			...this.overlay.querySelectorAll<HTMLButtonElement>(".peru-mode button"),
		];
		for (const b of this.modeBtns)
			b.onclick = () => this.setCameraMode(b.dataset.mode as CameraMode);
		this.flyHint = this.overlay.querySelector(".peru-fly-hint")!;
		this.imageryToggle = new ImageryToggle(
			imagery.availability,
			imagery.mode,
			(m) => {
				this.applyImagery();
				imagery.onChange(m);
			},
		);
		this.overlay.querySelector(".peru-mode")!.after(this.imageryToggle.el);
		this.vrBtn = this.overlay.querySelector(".peru-vr")!;
		this.vrBtn.onclick = async () => {
			if (!this.vrHandler) return;
			this.vrBtn.disabled = true;
			try {
				await this.vrHandler();
			} catch (err) {
				this.setStatus(
					`No se pudo entrar en VR: ${err instanceof Error ? err.message : String(err)}`,
				);
			} finally {
				this.vrBtn.disabled = false;
			}
		};
		this.overlay.hidden = true;
		container.append(this.overlay);

		// Touch fallback for fly mode: drag to look plus hold buttons (shown on coarse pointers only).
		this.flyPad = document.createElement("div");
		this.flyPad.className = "peru-fly-pad";
		this.flyPad.hidden = true;
		const pad: [string, string, string][] = [
			["KeyW", "Avanzar", "▲"],
			["KeyS", "Retroceder", "▼"],
			["KeyE", "Subir", "Subir"],
			["KeyQ", "Bajar", "Bajar"],
		];
		for (const [code, label, text] of pad) {
			const b = document.createElement("button");
			b.type = "button";
			b.textContent = text;
			b.setAttribute("aria-label", label);
			b.onpointerdown = (e) => {
				e.preventDefault();
				b.setPointerCapture(e.pointerId);
				this.fly.hold(code, true);
			};
			b.onpointerup =
				b.onpointercancel =
				b.onlostpointercapture =
					() => this.fly.hold(code, false);
			this.flyPad.append(b);
		}
		container.append(this.flyPad);

		if (weather) {
			this.weatherPanel = new WeatherPanel(
				weather.controller,
				"weather-overview",
			);
			this.weatherPanel.el.hidden = true;
			container.append(this.weatherPanel.el);
			this.cloudSheet = weather.gpu.cloudSheet(
				this.scene,
				this.frame,
				this.mapRoot,
			);
			this.cloudSheet.setExaggeration(this.exaggeration);
		}

		this.backBtn = document.createElement("button");
		this.backBtn.type = "button";
		this.backBtn.className = "peru-back";
		this.backBtn.textContent = "Volver al mapa del Perú";
		this.backBtn.hidden = true;
		this.backBtn.onclick = () => this.actions.backToMap();
		container.append(this.backBtn);
	}

	/**
	 * Starts streaming the relief (coarse roots first, then finer tiles as the camera gets
	 * closer); resolves once Peru is drawn, rejects when the tiles API fails.
	 */
	async load(client: TilesClient): Promise<void> {
		await client.health();
		void client
			.layers()
			.then(
				(capas) =>
					(this.attribution.textContent =
						attributionFrom(capas) ?? DEFAULT_ATTRIBUTION),
			);
		// The tiles follow the map root (identity except in the VR maquette, S2).
		this.terrain = new LodTerrain(
			this.scene,
			client,
			this.profile,
			this.frame,
			this.look(),
			{ parent: this.mapRoot },
			this.weather?.gpu.binding(this.scene, "shadow") ?? null,
		);
		this.applyImagery();
		this.frameTopDown();
		await this.terrain.ready;
		this.loaded = true;
		this.setStatus(null);
		this.syncDom();
	}

	/** Relieve / Satélite from the app (the other view's switch changed). */
	setImageryMode(mode: ImageryMode): void {
		this.imageryToggle.set(mode);
		this.applyImagery();
	}

	setImageryAttribution(text: string): void {
		this.imageryToggle.setAttribution(text);
	}

	imageryCredit(): { text: string; notice: string | null } | null {
		const s = this.imageryToggle.state;
		return s.credit ? { text: s.credit, notice: s.notice } : null;
	}

	weatherMenu(): WeatherMenuContent | null {
		const w = this.weather?.controller;
		if (!w) return null;
		const p = this.pickedPoint;
		return weatherMenuContent(
			w.snapshot(),
			p && w.available ? w.pointLines(p.lon, p.lat) : [],
		);
	}

	weatherAction(id: string): void {
		const w = this.weather?.controller;
		if (w) weatherMenuAction(w, id);
	}

	weatherCredit(): string | null {
		const a = this.weather?.controller.snapshot().attribution;
		return a ? `Datos meteorológicos: ${a}` : null;
	}

	/** Overlay footprint of the active camera (map-local km → Web Mercator unit square). */
	private weatherFocus(): WeatherFocus | null {
		const cam = this.scene.activeCamera;
		if (!cam) return null;
		let eye = cam.globalPosition.clone();
		let dir = cam.getDirection(Vector3.Forward());
		if (this.mapPlaced) {
			const inv = this.mapRoot.computeWorldMatrix(true).clone().invert();
			eye = Vector3.TransformCoordinates(eye, inv);
			dir = Vector3.TransformNormal(dir, inv);
		}
		const f = viewFocus(
			[eye.x, eye.y, eye.z],
			[dir.x, dir.y, dir.z],
			this.groundAt(eye.x, eye.z),
		);
		const [x, y] = localToWorld(this.frame, f.x, f.z);
		return { x, y, side: f.sideKm / this.frame.k };
	}

	private applyImagery(): void {
		const a = this.imagery.availability;
		this.terrain?.setImagery(
			a.available && this.imageryToggle.state.mode === "satellite"
				? a.source
				: null,
		);
	}

	private look() {
		return {
			exaggeration: this.exaggeration,
			fogColor: FOG_COLOR,
			fogDensity: this.fogDensity,
			hillshadeZ: HILLSHADE_Z,
		};
	}

	/** Every return to the map starts again from the whole of Peru seen from above (S7). */
	show(): void {
		if (!this.inVr) {
			this.setCameraMode("orbit");
			this.frameTopDown();
		}
		this.active = true;
		if (this.mode === "orbit") this.camera.attachControl(this.canvas, true);
		else this.fly.enabled = true;
		this.syncDom();
	}

	hide(): void {
		this.active = false;
		this.camera.detachControl();
		this.fly.enabled = false;
		this.fly.release();
		this.syncDom();
	}

	/** The simulator finished building: its actions ("Simular aquí", "Ir al simulador") become available. */
	setSimulatorReady(ready: boolean): void {
		this.simulatorReady = ready;
		this.skipBtn.title = ready ? "" : "Preparando el simulador…";
		this.syncDom();
	}

	/** Another simulator of the viewer (src/viewer/SimulatorMode.ts), opened from the map at its own origin. */
	addEntry(id: string, label: string, open: () => Promise<void>): void {
		this.entryOpeners.set(id, { label, open });
		const button = document.createElement("button");
		button.type = "button";
		button.className = "peru-entry";
		button.textContent = label;
		button.onclick = () => {
			if (!overviewButtons(this.buttonState()).skip) return;
			open().catch((err: unknown) =>
				this.setStatus(
					`No se pudo abrir ${label}: ${err instanceof Error ? err.message : String(err)}`,
				),
			);
		};
		(this.entryBtns.at(-1) ?? this.skipBtn).after(button);
		this.entryBtns.push(button);
		this.syncDom();
	}

	/** Offers "Entrar en VR" (Quest flight); the handler lazy-loads the XR code. */
	enableVr(handler: () => Promise<void>): void {
		this.vrHandler = handler;
		this.vrBtn.hidden = false;
	}

	/** Marks the active "Simular aquí" simulation (null: none, e.g. synthetic ravine or a DEM file). */
	setActiveSimulation(sim: ActiveSimulation | null): void {
		this.activeSim = sim;
		this.skipBtn.textContent = skipLabel(sim?.label ?? null);
		this.placeSiteMarker();
	}

	get cameraMode(): CameraMode {
		return this.mode;
	}

	private frameTopDown(): void {
		const view = topDownView(
			this.peruBounds,
			this.camera.fov,
			this.scene.getEngine().getAspectRatio(this.camera),
		);
		this.camera.upperRadiusLimit = Math.max(ORBIT_MAX_RADIUS, view.radius);
		this.camera.setTarget(new Vector3(...view.target));
		this.camera.alpha = view.alpha;
		this.camera.beta = view.beta;
		this.camera.radius = view.radius;
	}

	/** "Órbita" ↔ "Vuelo libre", keeping the view: the fly camera starts where the orbit camera is. */
	setCameraMode(mode: CameraMode): void {
		if (mode === this.mode || this.inVr) return;
		this.mode = mode;
		if (mode === "fly") {
			this.camera.detachControl();
			this.fly.lookFrom(
				this.camera.position.clone(),
				this.camera.target.clone(),
			);
			this.scene.activeCamera = this.fly.camera;
			this.fly.enabled = this.active;
		} else {
			this.fly.enabled = false;
			this.fly.release();
			const eye = this.fly.camera.position.clone();
			const dir = this.fly.camera.getDirection(Vector3.Forward());
			const agl = Math.max(10, eye.y - this.groundAt(eye.x, eye.z));
			const reach = dir.y < -0.05 ? Math.min(3000, agl / -dir.y) : 500;
			const target = eye.add(dir.scale(reach));
			target.y = this.groundAt(target.x, target.z);
			this.camera.setTarget(target);
			this.camera.setPosition(eye);
			this.scene.activeCamera = this.camera;
			if (this.active) this.camera.attachControl(this.canvas, true);
		}
		this.syncDom();
	}

	// --- FlightHost (Quest / WebXR) ---

	vrStart(): { position: Vec3; yaw: number } {
		return vrStartPose(this.localBounds, this.exaggeration);
	}

	eye(): { position: Vec3; yaw: number } {
		if (this.mode === "fly") {
			const p = this.fly.camera.position;
			return { position: [p.x, p.y, p.z], yaw: this.fly.camera.rotation.y };
		}
		const p = this.camera.position;
		const d = this.camera.target.subtract(p);
		return { position: [p.x, p.y, p.z], yaw: Math.atan2(d.x, d.z) };
	}

	groundAt(x: number, z: number): number {
		return (this.terrain?.heightKm(x, z) ?? 0) * this.exaggeration;
	}

	bounds(): Bounds {
		return this.localBounds;
	}

	/** The streamed relief has no CPU mesh: the ray is marched against the clearance sampler. */
	hitRay(origin: Vec3, direction: Vec3): Vec3 | null {
		const local = this.localHit(origin, direction);
		if (!local || !this.mapPlaced) return local;
		const w = Vector3.TransformCoordinates(
			new Vector3(...local),
			this.mapRoot.computeWorldMatrix(true),
		);
		return [w.x, w.y, w.z];
	}

	pickRay(origin: Vec3, direction: Vec3): boolean {
		const hit = this.localHit(origin, direction);
		if (!hit) return false;
		this.pickLocal(hit[0], hit[2]);
		return true;
	}

	/** Ray (world) against the relief, in map-local km (through the inverse map root in the maquette). */
	private localHit(origin: Vec3, direction: Vec3): Vec3 | null {
		if (!this.terrain) return null;
		let o = origin;
		let d = direction;
		if (this.mapPlaced) {
			const inv = this.mapRoot.computeWorldMatrix(true).clone().invert();
			const lo = Vector3.TransformCoordinates(new Vector3(...origin), inv);
			const ld = Vector3.TransformNormal(
				new Vector3(...direction),
				inv,
			).normalize();
			o = [lo.x, lo.y, lo.z];
			d = [ld.x, ld.y, ld.z];
		}
		return raycastGround(o, d, (x, z) => this.groundAt(x, z), PICK_DISTANCE);
	}

	picked(): PickedPoint | null {
		return this.pickedPoint;
	}

	clearPick(): void {
		this.pickedPoint = null;
		this.pickInfo.textContent = "";
		this.placeMarker();
		this.syncDom();
	}

	entries(): { id: string; label: string }[] {
		return [...this.entryOpeners].map(([id, { label }]) => ({ id, label }));
	}

	async openEntry(id: string): Promise<string | null> {
		const entry = this.entryOpeners.get(id);
		if (!entry) return `Simulador desconocido: ${id}`;
		try {
			await entry.open();
			return null;
		} catch (err) {
			return err instanceof Error ? err.message : String(err);
		}
	}

	simulatePicked(): Promise<string | null> {
		return this.simulate();
	}

	/** The relief is loaded (the map can be shown, also from the simulator's VR panel). */
	get available(): boolean {
		return this.loaded;
	}

	setMapPlacement(
		t: { scaling: Vec3; yaw: number; position: Vec3 } | null,
	): void {
		this.mapPlaced = !!t;
		this.mapRoot.scaling.set(...(t?.scaling ?? [1, 1, 1]));
		this.mapRoot.rotation.set(0, t?.yaw ?? 0, 0);
		this.mapRoot.position.set(...(t?.position ?? [0, 0, 0]));
		this.mapRoot.computeWorldMatrix(true);
	}

	vrChanged(inVr: boolean, eyePixelHeight?: number): void {
		this.inVr = inVr;
		if (eyePixelHeight) this.xrEyePixels = eyePixelHeight;
		if (inVr) {
			this.fly.enabled = false;
			this.fly.release();
			this.saved = {
				mode: this.mode,
				alpha: this.camera.alpha,
				beta: this.camera.beta,
				radius: this.camera.radius,
				target: this.camera.target.clone(),
				flyPos: this.fly.camera.position.clone(),
				flyRot: this.fly.camera.rotation.clone(),
			};
		} else if (this.saved) {
			// Back to the web overview exactly as it was before entering VR.
			const s = this.saved;
			this.saved = null;
			this.camera.setTarget(s.target);
			this.camera.alpha = s.alpha;
			this.camera.beta = s.beta;
			this.camera.radius = s.radius;
			this.fly.camera.position.copyFrom(s.flyPos);
			this.fly.camera.rotation.copyFrom(s.flyRot);
			this.scene.activeCamera =
				s.mode === "fly" ? this.fly.camera : this.camera;
			if (s.mode === "fly") {
				this.camera.detachControl();
				this.fly.enabled = this.active;
			} else if (!this.active) {
				// The session ended in the simulator (S2): Babylon re-attached the orbit camera.
				this.camera.detachControl();
			}
		}
		this.syncDom();
	}

	/** The tiles API failed: no overview, no way back to it. */
	unavailable(): void {
		this.loaded = false;
		this.hide();
	}

	/**
	 * Fog by view distance (S11): the orbit radius, or the eye height over the relief in flight
	 * (web or VR). The VR maquette is metres across, where the fog is negligible anyway.
	 */
	private adaptFog(cam: Camera): void {
		const eye = cam.globalPosition;
		const viewKm = this.mapPlaced
			? 0
			: !this.inVr && this.mode === "orbit"
				? this.camera.radius
				: eye.y - this.groundAt(eye.x, eye.z);
		const density = fogDensityAt(viewKm);
		if (
			Math.abs(density - this.fogDensity) <=
			this.fogDensity * FOG_UPDATE_RATIO
		)
			return;
		this.fogDensity = density;
		this.scene.fogDensity = density;
		this.terrain?.setFogDensity(density);
	}

	render(): void {
		const engine = this.scene.getEngine();
		if (!this.inVr) this.stepZoom(Math.min(engine.getDeltaTime() / 1000, 0.1));
		if (this.mode === "fly" && !this.inVr)
			this.fly.update(engine.getDeltaTime() / 1000);
		if (this.mode === "orbit" && !this.inVr)
			this.camera.minZ = Math.min(
				1,
				Math.max(0.05, this.camera.radius / ORBIT_NEAR_RATIO),
			);
		const cam = this.scene.activeCamera;
		if (cam) this.adaptFog(cam);
		if (this.weather && this.terrain) {
			this.weather.gpu.update(performance.now(), this.weatherFocus());
			this.cloudSheet?.update();
		}
		if (this.terrain && cam) {
			const now = performance.now();
			// Web: SSE in CSS-like px (render height / capped DPR); VR: eye-buffer px.
			const px = this.inVr
				? this.xrEyePixels
				: engine.getRenderHeight() /
					Math.min(Math.max(window.devicePixelRatio, 1), 2);
			this.terrain.update(
				now,
				viewOf(
					cam,
					px,
					this.mapPlaced ? this.mapRoot.computeWorldMatrix(true) : null,
				),
			);
			if (now - this.lastHud > HUD_INTERVAL_MS) {
				this.lastHud = now;
				const s = this.terrain.stats;
				this.lodInfo.textContent =
					`LOD: ${s.drawn} tiles · nivel máx. z${s.maxZoom} · ${s.inFlight} en vuelo · ${s.queued} en cola · ` +
					`${s.cached}/${this.profile.cacheCapacity} en caché · perfil ${this.profile.id} · ${engine.getFps().toFixed(0)} fps` +
					(s.imagery
						? ` · satélite: ${s.imagery.inFlight} en vuelo, ${s.imagery.cached}/${s.imagery.capacity} en caché`
						: "");
			}
		}
		this.scene.render();
	}

	dispose(): void {
		this.fly.dispose();
		this.terrain?.dispose();
		this.scene.dispose();
	}

	/** Debug/verification hook (window.__app.overview.weatherStats()). */
	weatherStats() {
		return this.weather?.gpu.stats() ?? null;
	}

	/** Debug/verification hook (window.__app.overview.lodStats()). */
	lodStats() {
		return this.terrain?.stats ?? null;
	}

	setStatus(text: string | null): void {
		this.status.textContent = text ?? "";
		this.status.hidden = !text;
	}

	private syncDom(): void {
		this.overlay.hidden = !this.active || this.inVr;
		for (const b of this.modeBtns)
			b.setAttribute("aria-pressed", String(b.dataset.mode === this.mode));
		this.flyHint.hidden = this.mode !== "fly";
		this.flyPad.hidden = !this.active || this.inVr || this.mode !== "fly";
		if (this.weatherPanel)
			this.weatherPanel.el.hidden = !this.active || this.inVr;
		this.backBtn.hidden = this.active || !this.loaded;
		const enabled = overviewButtons(this.buttonState());
		this.simulateBtn.disabled = !enabled.simulate;
		this.skipBtn.disabled = !enabled.skip;
		for (const button of this.entryBtns) button.disabled = !enabled.skip;
	}

	private buttonState() {
		return {
			loaded: this.loaded,
			picked: !!this.pickedPoint,
			busy: this.busy,
			simulatorReady: this.simulatorReady,
		};
	}

	/** "Simular aquí" (web button and VR card); resolves with the error text, or null. */
	private async simulate(): Promise<string | null> {
		const p = this.pickedPoint;
		if (!p || !overviewButtons(this.buttonState()).simulate)
			return "Espera a que termine la carga en curso";
		this.busy = true;
		this.syncDom();
		this.setStatus("Descargando el terreno real de la zona (z11)…");
		try {
			await this.actions.simulateHere(p);
			this.setStatus(null);
			return null;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.setStatus(`No se pudo preparar la simulación: ${message}`);
			return message;
		} finally {
			this.busy = false;
			this.syncDom();
		}
	}

	private setExaggeration(v: number): void {
		this.exaggeration = v;
		this.terrain?.setLook(this.look());
		this.cloudSheet?.setExaggeration(v);
		this.placeMarker();
		this.placeSiteMarker();
		// A higher relief must not swallow the fly camera.
		if (this.mode === "fly")
			this.fly.lookFrom(
				this.fly.camera.position.clone(),
				this.fly.camera.position.add(
					this.fly.camera.getDirection(Vector3.Forward()),
				),
			);
	}

	private pickAt(x: number, y: number): void {
		const cam = this.scene.activeCamera;
		if (!cam || this.busy) return;
		const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), cam);
		this.pickRay(
			[ray.origin.x, ray.origin.y, ray.origin.z],
			[ray.direction.x, ray.direction.y, ray.direction.z],
		);
	}

	/**
	 * Double-click "zoom hacia ahí": orbit moves its target to the point and shrinks the radius
	 * to ZOOM.fraction; fly flies the eye toward it (same rule as the VR trigger). Eased.
	 */
	private zoomAt(x: number, y: number): void {
		const cam = this.scene.activeCamera;
		if (!cam) return;
		const ray = this.scene.createPickingRay(x, y, Matrix.Identity(), cam);
		const o = ray.origin;
		const hit = this.hitRay(
			[o.x, o.y, o.z],
			[ray.direction.x, ray.direction.y, ray.direction.z],
		);
		if (!hit) return;
		if (this.mode === "fly") {
			this.flyZoom = new ZoomTween(
				[o.x, o.y, o.z],
				zoomTarget(
					[o.x, o.y, o.z],
					hit,
					(a, b) => this.groundAt(a, b),
					this.localBounds,
				),
			);
		} else {
			const r1 = Math.max(
				this.camera.lowerRadiusLimit ?? 0,
				this.camera.radius * ZOOM.fraction,
			);
			this.orbitZoom = {
				from: this.camera.target.clone(),
				to: new Vector3(...hit),
				r0: this.camera.radius,
				r1,
				t: 0,
			};
		}
	}

	private stepZoom(dt: number): void {
		if (this.flyZoom) {
			if (this.mode !== "fly") this.flyZoom = null;
			else {
				const d = this.flyZoom.step(dt);
				this.fly.camera.position.addInPlaceFromFloats(d[0], d[1], d[2]);
				if (this.flyZoom.done) this.flyZoom = null;
			}
		}
		const z = this.orbitZoom;
		if (z) {
			if (this.mode !== "orbit") this.orbitZoom = null;
			else {
				z.t = Math.min(1, z.t + dt / ZOOM.duration);
				const k = easeInOut(z.t);
				// Keep alpha/beta: the view slides with its target instead of turning toward it.
				this.camera.setTarget(
					Vector3.Lerp(z.from, z.to, k),
					false,
					false,
					true,
				);
				this.camera.radius = z.r0 + (z.r1 - z.r0) * k;
				if (z.t >= 1) this.orbitZoom = null;
			}
		}
	}

	/** Marks the overview point at scene (x, z) for "Simular aquí". */
	private pickLocal(x: number, z: number): void {
		if (!this.terrain) return;
		const { lon, lat } = localToLonLat(this.frame, x, z);
		// Finest loaded data (sea and nodata read 0 m).
		this.pickedPoint = { lon, lat, height: this.terrain.heightKm(x, z) * 1000 };
		const inside =
			lon >= PERU_BBOX.west &&
			lon <= PERU_BBOX.east &&
			lat >= PERU_BBOX.south &&
			lat <= PERU_BBOX.north;
		this.pickInfo.textContent =
			pointLabel(this.pickedPoint) +
			(inside ? "" : " (fuera del área del servicio)");
		// The weather grids reach 2° past the tiles: the point query answers outside too.
		this.weatherPanel?.setPoint({
			lon,
			lat,
			height: this.pickedPoint?.height ?? null,
		});
		if (!inside) this.pickedPoint = null;
		this.placeMarker();
		this.syncDom();
	}

	private placeSiteMarker(): void {
		const s = this.activeSim;
		this.siteBeacon.setEnabled(!!s);
		this.siteFootprint.setEnabled(!!s);
		if (!s) return;
		const m = activeSiteMarker(this.frame, s, this.exaggeration, s.height);
		const beacon = 40;
		this.siteBeacon.scaling.y = beacon;
		this.siteBeacon.position.set(m.x, m.ground + beacon / 2, m.z);
		// A thin slab over the patch, just above the exaggerated relief at the site.
		this.siteFootprint.scaling.set(m.footprint, 0.4, m.footprint);
		this.siteFootprint.position.set(m.x, m.ground + 0.5, m.z);
	}

	private placeMarker(): void {
		const p = this.pickedPoint;
		if (!p) {
			this.marker.setEnabled(false);
			return;
		}
		const w = lonLatToWorld(p.lon, p.lat);
		const [x, z] = worldToLocal(this.frame, w.x, w.y);
		const ground = (Math.max(p.height ?? 0, 0) / 1000) * this.exaggeration;
		const height = 60;
		this.marker.scaling.y = height;
		this.marker.position.set(x, ground + height / 2, z);
		this.marker.setEnabled(true);
	}
}
