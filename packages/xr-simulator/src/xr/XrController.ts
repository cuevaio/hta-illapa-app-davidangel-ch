import {
	Ray as BabylonRay,
	Color4,
	type Mesh,
	type Scene,
	Vector3,
	type WebXRDefaultExperience,
	WebXRFeatureName,
	type WebXRInputSource,
	WebXRState,
} from "@babylonjs/core";
import type {
	PointerListener,
	PointerSample,
	PointerSource,
} from "../input/pointer";
import type { ResultActions } from "../playback/ResultActions";
import type { World } from "../render/World";
import type { Terrain } from "../scenario/terrain";
import type { SolverStats } from "../solver/Solver";
import type { AppState } from "../state/appState";
import type { Store } from "../state/store";
import type { WeatherMenuContent } from "../ui/sections";
import { VrPanel } from "../ui/vr/VrPanel";
import {
	controllerYaw,
	grabOneHand,
	grabTwoHands,
	immersivePlacement,
	type MaquettePose,
	panelInFront,
	RaySmoother,
	type RootPlacement,
	rootFromPose,
	snapTurn,
} from "./placement";

/** What the XR layer needs from the app. Everything else (solver, tools) stays shared. */
export interface XrHost {
	scene: Scene;
	world: World;
	store: Store<AppState>;
	webgpu: boolean;
	terrain(): Terrain;
	terrainMesh(): Mesh;
	/** Emitter position (terrain-local), used as the immersive starting point. */
	startPoint(): [number, number];
	resetSimulation(): void;
	result: ResultActions;
	onSessionChange(inXr: boolean): void;
	/** "Volver al mapa del Perú" in the panel (S2): hands the VR session to the map, staying in VR. */
	backToMap?(): void;
	/** Whether the Peru map can be shown (its relief loaded). */
	mapAvailable?(): boolean;
	/** The weather menu page of the panel (S8). */
	weather?: {
		content(): WeatherMenuContent | null;
		action(id: string): void;
	};
}

/** Table top in front of the user for the maquette (metres, XR local-floor space). */
const TABLE_CENTER: [number, number, number] = [0, 0.85, 0.9];
/** Maquette size limits while scaling with two hands (m). */
const TABLE_MIN = 0.2;
const TABLE_MAX = 6;
const SNAP_TURN = Math.PI / 6;

type Grab =
	| {
			kind: "one";
			id: string;
			pose: MaquettePose;
			hand: [number, number, number];
			yaw: number;
	  }
	| {
			kind: "two";
			ids: [string, string];
			pose: MaquettePose;
			a: [number, number, number];
			b: [number, number, number];
	  };

/**
 * Immersive session handling. Loaded with a dynamic import only after the user presses
 * "Entrar en VR/AR", so the web version never loads or runs XR code.
 */
export class XrController {
	readonly pointers: XrPointerSource;
	private panel: VrPanel | null = null;
	private clearColor: Color4;
	private unwatch: (() => void)[] = [];
	private inXr = false;
	/** Maquette pose; moved by grabbing, kept across mode switches within a session. */
	private pose: MaquettePose | null = null;
	private readonly squeezing = new Set<string>();
	private grab: Grab | null = null;
	private snapArmed = true;
	/** Controller currently holding the panel (grip pressed while pointing at it). */
	private panelHolder: string | null = null;
	private summonArmed = true;
	/** Mode of the current session (the way back to the map exists in VR only). */
	private mode: XRSessionMode = "immersive-vr";
	/** False while the Peru map has the shared session (src/xr/sharedSession.ts). */
	private active = true;

	private constructor(
		private readonly host: XrHost,
		private readonly xr: WebXRDefaultExperience,
	) {
		this.clearColor = host.scene.clearColor.clone();
		this.pointers = new XrPointerSource(
			xr,
			host.store,
			() => this.panel?.mesh ?? null,
		);
		const sm = xr.baseExperience.sessionManager;
		sm.onXRSessionInit.add((session) => {
			session.addEventListener("squeezestart", (e) => this.squeeze(e, true));
			session.addEventListener("squeezeend", (e) => this.squeeze(e, false));
		});
		sm.onXRFrameObservable.add(() => this.manipulate());
		xr.baseExperience.onStateChangedObservable.add((state) => {
			if (state === WebXRState.IN_XR) this.onEnter();
			else if (state === WebXRState.NOT_IN_XR && this.inXr) this.onExit();
		});
	}

	static async create(host: XrHost): Promise<XrController> {
		const xr = await host.scene.createDefaultXRExperienceAsync({
			disableDefaultUI: true,
			floorMeshes: [],
			// Hands, where available, act like controllers through the same select events.
			disableHandTracking: false,
		});
		// WebGPU XR goes through XRGPUBinding, which Babylon exposes via the layers feature.
		if (host.webgpu)
			xr.baseExperience.featuresManager.enableFeature(
				WebXRFeatureName.LAYERS,
				"stable",
			);
		return new XrController(host, xr);
	}

	get experience(): WebXRDefaultExperience {
		return this.xr;
	}

	/** The Peru map takes the shared session: ignore controllers, drop grabs and held panels. */
	pause(): void {
		this.active = false;
		this.pointers.active = false;
		this.pointers.reset();
		this.grab = null;
		this.squeezing.clear();
		if (this.panelHolder !== null) this.panel?.mesh.setParent(null);
		this.panelHolder = null;
	}

	/** The simulator gets the shared session back (after "Simular aquí" in VR). */
	resume(): void {
		this.active = true;
		this.pointers.active = true;
		this.summonArmed = false;
		if (this.inXr) this.place(true);
	}

	async enter(mode: XRSessionMode): Promise<void> {
		this.mode = mode;
		if (mode === "immersive-ar")
			this.host.scene.clearColor = new Color4(0, 0, 0, 0);
		try {
			await this.xr.baseExperience.enterXRAsync(mode, "local-floor");
		} catch (err) {
			this.host.scene.clearColor = this.clearColor;
			throw err;
		}
	}

	exit(): Promise<void> {
		return this.xr.baseExperience.exitXRAsync();
	}

	/** Haptic tick on the controller that confirmed an edit. */
	pulse(pointerId: string): void {
		void this.pointers.controller(pointerId)?.motionController?.pulse(0.6, 60);
	}

	setStats(stats: SolverStats, massError: number): void {
		this.panel?.setStats(stats, massError);
	}

	/** Re-applies the placement after the terrain was rebuilt (resolution change, DEM). */
	terrainChanged(): void {
		if (this.inXr) this.place(false);
	}

	private onEnter(): void {
		this.inXr = true;
		const { store } = this.host;
		const back = this.host.backToMap;
		this.panel = new VrPanel(this.host.scene, store, {
			resetSimulation: () => this.host.resetSimulation(),
			exitXr: () => void this.exit(),
			result: this.host.result,
			backToMap:
				back && this.mode === "immersive-vr" ? () => back() : undefined,
			mapAvailable: () => this.host.mapAvailable?.() ?? false,
			weather: this.host.weather,
		});
		this.place(true);
		this.unwatch.push(
			store.watch(
				(s) => s.xr.mode,
				() => this.place(true),
			),
			store.watch(
				(s) => s.xr.tableSize,
				() => this.place(false),
			),
		);
		store.set({ session: "xr" });
		this.host.onSessionChange(true);
	}

	private onExit(): void {
		this.inXr = false;
		this.active = true;
		this.pointers.active = true;
		this.unwatch.forEach((u) => {
			u();
		});
		this.unwatch = [];
		this.xr.teleportation?.removeFloorMesh(this.host.terrainMesh());
		this.panel?.dispose();
		this.panel = null;
		this.pointers.reset();
		this.pose = null;
		this.grab = null;
		this.panelHolder = null;
		this.squeezing.clear();
		const root = this.host.world.root;
		root.scaling.setAll(1);
		root.rotation.setAll(0);
		this.host.world.fitTerrain(this.host.terrain());
		this.host.scene.clearColor = this.clearColor;
		this.host.store.set({ session: "web" });
		this.host.onSessionChange(false);
	}

	/** Positions the terrain root (and the panel) for the current mode; `resetView` recentres the user. */
	private place(resetView: boolean): void {
		const { store, world } = this.host;
		const terrain = this.host.terrain();
		const xrState = store.get().xr;
		const teleport = this.xr.teleportation;
		const mesh = this.host.terrainMesh();
		if (xrState.mode === "maquette") {
			const scale = xrState.tableSize / terrain.size;
			this.pose = this.pose
				? { ...this.pose, scale }
				: { center: [...TABLE_CENTER], yaw: 0, scale };
			this.applyPose();
			teleport?.removeFloorMesh(mesh);
			// The right thumbstick turns the maquette instead of the user.
			if (teleport) teleport.rotationEnabled = false;
		} else {
			const start = this.host.startPoint();
			const p: RootPlacement = immersivePlacement(
				start,
				terrain.heightAt(start[0], start[1]),
			);
			world.root.scaling.setAll(p.scale);
			world.root.rotation.setAll(0);
			world.root.position.set(...p.position);
			teleport?.addFloorMesh(mesh);
			if (teleport) teleport.rotationEnabled = true;
		}
		if (resetView) {
			const cam = this.xr.baseExperience.camera;
			cam.position.set(0, cam.position.y, 0);
			this.summonPanel();
		}
	}

	private applyPose(): void {
		if (!this.pose) return;
		const terrain = this.host.terrain();
		const [lo, hi] = terrain.minMax();
		const p = rootFromPose(
			{ size: terrain.size, minHeight: lo, maxHeight: hi },
			this.pose,
		);
		const root = this.host.world.root;
		root.scaling.setAll(p.scale);
		root.rotation.set(0, p.yaw, 0);
		root.position.set(...p.position);
	}

	private squeeze(e: XRInputSourceEvent, down: boolean): void {
		if (!this.active) return;
		const id = this.pointers.idOf(e.inputSource);
		if (!id) return;
		// Grip while pointing at the panel moves the panel, not the maquette.
		const panel = this.panel?.mesh;
		if (
			down &&
			panel &&
			this.panelHolder === null &&
			this.pointers.pointsAtPanel(id)
		) {
			this.panelHolder = id;
			const holder = this.pointers.controller(id)?.pointer;
			if (holder) panel.setParent(holder);
			return;
		}
		if (!down && id === this.panelHolder) {
			this.panelHolder = null;
			panel?.setParent(null);
			return;
		}
		if (down) this.squeezing.add(id);
		else this.squeezing.delete(id);
		this.startGrab();
	}

	/** (Re)starts a grab from the current hands so switching one ↔ two hands never jumps. */
	private startGrab(): void {
		this.grab = null;
		if (!this.pose || this.host.store.get().xr.mode !== "maquette") return;
		const ids = [...this.squeezing];
		if (ids.length === 1) {
			const h = this.pointers.hand(ids[0]);
			if (h)
				this.grab = {
					kind: "one",
					id: ids[0],
					pose: { ...this.pose },
					hand: h.position,
					yaw: h.yaw,
				};
		} else if (ids.length >= 2) {
			const a = this.pointers.hand(ids[0]);
			const b = this.pointers.hand(ids[1]);
			if (a && b)
				this.grab = {
					kind: "two",
					ids: [ids[0], ids[1]],
					pose: { ...this.pose },
					a: a.position,
					b: b.position,
				};
		}
	}

	/** Per XR frame: summon the panel, grab manipulation and thumbstick snap turns of the maquette. */
	private manipulate(): void {
		if (!this.inXr || !this.active) return;
		this.panel?.refreshWeather();
		const summon = this.pointers.summonPressed();
		if (summon && this.summonArmed) this.summonPanel();
		this.summonArmed = !summon;
		if (!this.pose || this.host.store.get().xr.mode !== "maquette") return;
		const size = this.host.terrain().size;
		const g = this.grab;
		if (g?.kind === "one") {
			const h = this.pointers.hand(g.id);
			if (h)
				this.pose = grabOneHand(
					g.pose,
					{ hand: g.hand, yaw: g.yaw },
					{ hand: h.position, yaw: h.yaw },
				);
		} else if (g?.kind === "two") {
			const a = this.pointers.hand(g.ids[0]);
			const b = this.pointers.hand(g.ids[1]);
			if (a && b)
				this.pose = grabTwoHands(
					g.pose,
					{ a: g.a, b: g.b },
					{ a: a.position, b: b.position },
					{ min: TABLE_MIN / size, max: TABLE_MAX / size },
				);
		} else {
			const x = this.pointers.thumbstickX("right");
			if (Math.abs(x) < 0.3) this.snapArmed = true;
			else if (Math.abs(x) > 0.7 && this.snapArmed) {
				this.snapArmed = false;
				this.pose = snapTurn(this.pose, Math.sign(x) * SNAP_TURN);
			}
		}
		this.applyPose();
		const tableSize = this.pose.scale * size;
		if (Math.abs(tableSize - this.host.store.get().xr.tableSize) > 1e-6) {
			this.host.store.set((s) => ({ xr: { ...s.xr, tableSize } }));
		}
	}

	/** Brings the panel in front of the user, facing them (X/Y or left thumbstick press). */
	private summonPanel(): void {
		const panel = this.panel?.mesh;
		if (!panel || this.panelHolder !== null) return;
		const cam = this.xr.baseExperience.camera;
		const head = cam.globalPosition;
		const f = cam.getDirection(Vector3.Forward());
		const p = panelInFront([head.x, head.y, head.z], [f.x, f.y, f.z]);
		panel.setParent(null);
		panel.scaling.setAll(1);
		panel.position.set(...p.position);
		panel.rotation.set(0, p.yaw, 0);
	}
}

/**
 * Controllers (and tracked hands) as pointer sources: the same rays and phases the tools get
 * from the mouse. Ray = world space; the app converts it to terrain-local with the inverse root
 * transform, so a maquette's scale is undone before the heightmap raycast.
 */
export class XrPointerSource implements PointerSource {
	private readonly listeners = new Set<PointerListener>();
	private readonly sources = new Map<
		string,
		{
			input: WebXRInputSource;
			pressed: boolean;
			smoother: RaySmoother;
			onPanel: boolean;
		}
	>();
	private readonly ray = new BabylonRay(Vector3.Zero(), Vector3.Forward());
	/** False while the Peru map has the shared session: no tool gestures from its presses. */
	active = true;

	constructor(
		xr: WebXRDefaultExperience,
		private readonly store: Store<AppState>,
		private readonly panel: () => Mesh | null,
	) {
		xr.input.onControllerAddedObservable.add((input) => {
			this.sources.set(input.uniqueId, {
				input,
				pressed: false,
				smoother: new RaySmoother(),
				onPanel: false,
			});
		});
		xr.input.onControllerRemovedObservable.add((input) =>
			this.sources.delete(input.uniqueId),
		);
		const sm = xr.baseExperience.sessionManager;
		sm.onXRSessionInit.add((session) => {
			session.addEventListener("selectstart", (e) => this.select(e, "down"));
			session.addEventListener("selectend", (e) => this.select(e, "up"));
		});
		sm.onXRFrameObservable.add(() => {
			if (!this.active) return;
			for (const id of this.sources.keys()) this.emit(id, "move");
		});
	}

	controller(id: string): WebXRInputSource | undefined {
		return this.sources.get(id)?.input;
	}

	idOf(source: XRInputSource): string | null {
		for (const [id, s] of this.sources)
			if (s.input.inputSource === source) return id;
		return null;
	}

	/** World position of a hand/controller grip and its heading, for grabbing the maquette. */
	hand(id: string): { position: [number, number, number]; yaw: number } | null {
		const s = this.sources.get(id);
		if (!s) return null;
		const node = s.input.grip ?? s.input.pointer;
		const p = node.absolutePosition;
		const f = s.input.pointer.forward;
		return { position: [p.x, p.y, p.z], yaw: controllerYaw([f.x, f.y, f.z]) };
	}

	pointsAtPanel(id: string): boolean {
		const s = this.sources.get(id);
		return s ? this.hitsPanel(s.input) : false;
	}

	/** X or Y on the left controller, or a left thumbstick press. */
	summonPressed(): boolean {
		for (const { input } of this.sources.values()) {
			if (input.inputSource.handedness !== "left") continue;
			const mc = input.motionController;
			if (!mc) continue;
			return ["x-button", "y-button", "xr-standard-thumbstick"].some(
				(c) => mc.getComponent(c)?.pressed,
			);
		}
		return false;
	}

	thumbstickX(handedness: XRHandedness): number {
		for (const { input } of this.sources.values()) {
			if (input.inputSource.handedness !== handedness) continue;
			return (
				input.motionController?.getComponentOfType("thumbstick")?.axes.x ?? 0
			);
		}
		return 0;
	}

	reset(): void {
		for (const s of this.sources.values()) {
			s.pressed = false;
			s.smoother.reset();
		}
	}

	private select(e: XRInputSourceEvent, phase: "down" | "up"): void {
		if (!this.active) return;
		for (const [id, s] of this.sources) {
			if (s.input.inputSource !== e.inputSource) continue;
			// A press that starts on the panel belongs to the panel (Babylon GUI), not to the tools.
			if (phase === "down") s.onPanel = this.hitsPanel(s.input);
			if (s.onPanel) {
				if (phase === "up") s.onPanel = false;
				return;
			}
			s.pressed = phase === "down";
			this.emit(id, phase);
		}
	}

	private hitsPanel(input: WebXRInputSource): boolean {
		const panel = this.panel();
		if (!panel) return false;
		input.getWorldPointerRayToRef(this.ray);
		return this.ray.intersectsMesh(panel).hit;
	}

	private emit(id: string, phase: PointerSample["phase"]): void {
		const s = this.sources.get(id);
		if (!s) return;
		s.input.getWorldPointerRayToRef(this.ray);
		const raw = {
			origin: [this.ray.origin.x, this.ray.origin.y, this.ray.origin.z] as [
				number,
				number,
				number,
			],
			direction: [
				this.ray.direction.x,
				this.ray.direction.y,
				this.ray.direction.z,
			] as [number, number, number],
		};
		const xr = this.store.get().xr;
		const ray = s.smoother.next(raw, xr.mode === "maquette" ? xr.smoothing : 0);
		const sample: PointerSample = {
			id,
			kind: s.input.inputSource.hand ? "xr-hand" : "xr-controller",
			phase,
			ray,
			primary: s.input.inputSource.handedness !== "left",
			travel: 0,
			pressed: phase === "down" || (phase === "move" && s.pressed),
			toolGesture: !s.onPanel,
		};
		this.listeners.forEach((l) => {
			l(sample);
		});
	}

	subscribe(listener: PointerListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		this.listeners.clear();
	}
}
