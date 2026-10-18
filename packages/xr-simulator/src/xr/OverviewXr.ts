import {
	Ray as BabylonRay,
	Mesh,
	MeshBuilder,
	type MotionControllerComponentType,
	Quaternion,
	Vector3,
	type WebXRDefaultExperience,
	WebXRFeatureName,
	type WebXRInputSource,
	WebXRState,
} from "@babylonjs/core";
import { AdvancedDynamicTexture, TextBlock } from "@babylonjs/gui";
import {
	clampAltitude,
	clampToBounds,
	DoubleTap,
	deadZone,
	FLY,
	gazeVelocity,
	gripStickMove,
	snapTurnStep,
	type Vec3,
	vrTiltAxis,
	ZoomTween,
	zoomTarget,
} from "../map/flight";
import type { FlightHost } from "../map/PeruOverview";
import {
	applyRig,
	composeRig,
	IDENTITY_RIG,
	type Rig,
	yawAbout,
} from "../map/rig";
import { entryActions, pointCardContent } from "../ui/sections";
import { VrPointCard } from "../ui/vr/VrPointCard";
import { VrWeatherMenu } from "../ui/vr/VrWeatherMenu";
import {
	type GrabHand,
	mapRootFromPose,
	TableGrab,
	tableInFront,
	tableScaleLimits,
} from "./mapTable";
import { controllerYaw, type MaquettePose, snapTurn } from "./placement";
import {
	controlsHint,
	gripUse,
	triggerUse,
	type VrEvent,
	type VrState,
	type VrView,
} from "./vrMode";

/**
 * Scale: the overview scene is in km and WebXR maps 1 real metre to 1 scene unit, so the
 * flight is over a 1:1000 relief model (1 m around you = 1 km of Peru; the vertical
 * exaggeration of the web slider applies on top).
 */
const STICK_DEAD_ZONE = 0.15;
/** "Simular aquí" card: distance along the gaze and drop below it (m). */
const CARD_DISTANCE = 0.6;
const CARD_DROP = 0.08;
/** Weather menu (X): distance along the gaze and shift to the left of it, beside the card (m). */
const WEATHER_MENU_DISTANCE = 0.9;
const WEATHER_MENU_LEFT = 0.45;

/** The app's VR state (src/xr/vrMode.ts), shared with the simulator's VR in the same session. */
export interface VrMapLink {
	state(): VrState;
	dispatch(e: VrEvent): void;
}

/**
 * Immersive VR over the Peru overview (Quest): flight ("Vuelo") or the whole map on a table
 * ("Maqueta"), and the "Simular aquí" card (S2). Loaded with a dynamic import only when VR over
 * the map is first needed; the session can be shared with the simulator's XrController
 * (src/xr/sharedSession.ts).
 */
export class OverviewXr {
	private inXr = false;
	private startPending = false;
	private snap = { armed: true };
	private readonly buttons = new Map<string, boolean>();
	private hint: Mesh | null = null;
	private hintText: TextBlock | null = null;
	/** View currently applied to the rig and the map root (follows the app's VR state). */
	private view: VrView = "vuelo";
	/** After a pause (the simulator had the session) the first frame only records button states. */
	private primeButtons = false;
	private card: VrPointCard | null = null;
	private weatherMenu: VrWeatherMenu | null = null;
	private cardShown = "";
	private cardBusy = false;
	private cardError: string | null = null;
	/** Label of the simulator being opened from the card (S5); null for "Simular aquí". */
	private cardOpening: string | null = null;
	/** Maquette: table pose (XR metres) and the grip manipulation. */
	private table: MaquettePose | null = null;
	private readonly tableGrab = new TableGrab();
	private tableSnap = { armed: true };
	/** Imagery attribution (+ prototype notice) under the hint card while Satélite is visible (S7). */
	private credit: { mesh: Mesh; text: TextBlock; shown: string } | null = null;
	private readonly ray = new BabylonRay(Vector3.Zero(), Vector3.Forward());
	private zoom: ZoomTween | null = null;
	private readonly gripTap = new DoubleTap();
	/** World heading the map tilt is applied about (follows every yaw move of the rig); null = untilted. */
	private tiltHeading: number | null = null;
	/** Everything the rig moved this frame (stick, zoom, snap turn, clamps). */
	private frameMove: Rig = IDENTITY_RIG;

	private constructor(
		private readonly host: FlightHost,
		private readonly xr: WebXRDefaultExperience,
		private readonly link: VrMapLink,
	) {
		const cam = xr.baseExperience.camera;
		// We place the user ourselves; on exit the web camera keeps its own state.
		cam.compensateOnFirstFrame = false;
		cam.minZ = 0.02;
		cam.maxZ = 20_000;
		xr.baseExperience.sessionManager.onXRFrameObservable.add(() =>
			this.frame(),
		);
		xr.baseExperience.onStateChangedObservable.add((state) => {
			if (state === WebXRState.IN_XR) {
				this.inXr = true;
				this.startPending = true;
				this.snap = { armed: true };
				this.view = "vuelo";
				this.card = new VrPointCard(
					this.host.scene,
					{
						simulate: () => this.simulateFromCard(),
						cancel: () => this.closeCard(true),
						setView: (view) => this.link.dispatch({ type: "set-view", view }),
						openEntry: (id) => this.openEntryFromCard(id),
					},
					entryActions(this.host.entries()),
				);
				const weather = this.host.weatherMenu();
				this.weatherMenu = weather
					? new VrWeatherMenu(this.host.scene, weather, (id) =>
							this.host.weatherAction(id),
						)
					: null;
				// Eye buffer height (WebGL layer); the LOD measures its screen-space error in it.
				const layer = xr.baseExperience.sessionManager.session?.renderState
					.baseLayer as XRWebGLLayer | undefined;
				this.host.vrChanged(true, layer?.framebufferHeight || undefined);
			} else if (state === WebXRState.NOT_IN_XR && this.inXr) {
				this.inXr = false;
				this.hint?.dispose();
				this.hint = null;
				this.credit?.mesh.dispose();
				this.credit = null;
				this.hintText = null;
				this.card?.dispose();
				this.card = null;
				this.weatherMenu?.dispose();
				this.weatherMenu = null;
				this.cardShown = "";
				this.cardBusy = false;
				this.cardError = null;
				this.buttons.clear();
				this.zoom = null;
				this.tiltHeading = null;
				this.table = null;
				this.tableGrab.reset();
				this.view = "vuelo";
				this.host.setMapPlacement(null);
				this.host.vrChanged(false);
			}
		});
		xr.input.onControllerAddedObservable.add((input) => {
			if (input.inputSource.handedness === "right")
				input.onMotionControllerInitObservable.add(() =>
					this.attachHint(input),
				);
		});
	}

	static async create(
		host: FlightHost,
		webgpu: boolean,
		link: VrMapLink,
	): Promise<OverviewXr> {
		const xr = await host.scene.createDefaultXRExperienceAsync({
			disableDefaultUI: true,
			floorMeshes: [],
			disableTeleportation: true,
			disableHandTracking: true,
		});
		if (webgpu)
			xr.baseExperience.featuresManager.enableFeature(
				WebXRFeatureName.LAYERS,
				"stable",
			);
		return new OverviewXr(host, xr, link);
	}

	get experience(): WebXRDefaultExperience {
		return this.xr;
	}

	async enter(): Promise<void> {
		await this.xr.baseExperience.enterXRAsync("immersive-vr", "local-floor");
	}

	/** The map gets the shared session back (from the simulator): fresh button edges, no card. */
	resumed(): void {
		this.primeButtons = true;
		this.zoom = null;
		this.tableGrab.reset();
		this.cardBusy = false;
		this.cardError = null;
		this.card?.hide();
	}

	private frame(): void {
		if (!this.inXr) return;
		if (this.startPending) {
			this.startPending = false;
			this.toStartView();
			return;
		}
		const left = this.controller("left");
		const right = this.controller("right");
		if (this.primeButtons) {
			this.primeButtons = false;
			for (const c of [left, right]) {
				if (!c) continue;
				for (const [id, type] of [
					["xr-standard-trigger", "trigger"],
					["xr-standard-squeeze", "squeeze"],
					["a-button"],
					["b-button"],
					["x-button"],
					["y-button"],
				] as const)
					this.pressedOnce(c, id, type);
			}
			return;
		}
		this.syncCredit();
		this.frameMove = IDENTITY_RIG;
		const wanted = this.link.state().view;
		if (wanted !== this.view) this.applyView(wanted);
		if (left && this.pressedOnce(left, "y-button"))
			this.link.dispatch({ type: "toggle-view" });
		if (left && this.pressedOnce(left, "x-button")) this.toggleWeatherMenu();
		// Trigger: on the card it presses the card's buttons (pointer selection); otherwise the view decides.
		const triggered: WebXRInputSource[] = [];
		for (const c of [left, right]) {
			if (!c || !this.pressedOnce(c, "xr-standard-trigger", "trigger"))
				continue;
			c.getWorldPointerRayToRef(this.ray);
			const cardHit = [this.card, this.weatherMenu].some(
				(panel) => panel?.visible && this.ray.intersectsMesh(panel.mesh).hit,
			);
			if (triggerUse(this.view, cardHit) === "zoom") triggered.push(c);
		}
		if (gripUse(this.view) === "table") this.tableFrame(left, right);
		else this.flightFrame(left, right, triggered);

		if (right && this.pressedOnce(right, "a-button")) {
			right.getWorldPointerRayToRef(this.ray);
			const o = this.ray.origin;
			const d = this.ray.direction;
			if (this.host.pickRay([o.x, o.y, o.z], [d.x, d.y, d.z])) {
				void right.motionController?.pulse(0.5, 60);
				this.openCard();
			}
		}
		if (right && this.pressedOnce(right, "b-button"))
			void this.xr.baseExperience.exitXRAsync();
		this.syncCard();
		const weather = this.weatherMenu?.visible ? this.host.weatherMenu() : null;
		if (weather) this.weatherMenu?.update(weather);
	}

	/** X: the weather menu (S8) opens beside the gaze, or closes. */
	private toggleWeatherMenu(): void {
		const menu = this.weatherMenu;
		if (!menu) return;
		if (menu.visible) {
			menu.hide();
			return;
		}
		const cam = this.xr.baseExperience.camera;
		const head = cam.position;
		const gaze = cam.getDirection(Vector3.Forward());
		const left = cam.getDirection(Vector3.Left());
		menu.showAt([
			head.x + gaze.x * WEATHER_MENU_DISTANCE + left.x * WEATHER_MENU_LEFT,
			head.y + gaze.y * WEATHER_MENU_DISTANCE + left.y * WEATHER_MENU_LEFT,
			head.z + gaze.z * WEATHER_MENU_DISTANCE + left.z * WEATHER_MENU_LEFT,
		]);
	}

	/** Flight ("Vuelo"): stick flight, grip climb/turn, snap turn, trigger zoom (unchanged controls). */
	private flightFrame(
		left: WebXRInputSource | undefined,
		right: WebXRInputSource | undefined,
		triggered: WebXRInputSource[],
	): void {
		const cam = this.xr.baseExperience.camera;
		const stick = right?.motionController?.getComponentOfType("thumbstick");
		// Boost: press the right stick.
		const boost = !!stick?.pressed;
		const forward = -deadZone(stick?.axes.y ?? 0, STICK_DEAD_ZONE);
		const strafe = deadZone(stick?.axes.x ?? 0, STICK_DEAD_ZONE);
		const dt = Math.min(this.host.scene.getEngine().getDeltaTime() / 1000, 0.1);
		const p = cam.position;
		const agl = () => p.y - this.host.groundAt(p.x, p.z);
		const gaze = (): Vec3 => {
			const g = cam.getDirection(Vector3.Forward());
			return [g.x, g.y, g.z];
		};
		const grip =
			!!right?.motionController?.getComponentOfType("squeeze")?.pressed;
		if (
			right &&
			this.pressedOnce(right, "xr-standard-squeeze", "squeeze") &&
			this.gripTap.press(performance.now() / 1000)
		) {
			this.toStartView();
			void right.motionController?.pulse(0.5, 80);
			return;
		}
		if (grip) {
			// Grip held: the right stick climbs/descends and turns about the vertical through the head.
			const g = gripStickMove(
				{ x: stick?.axes.x ?? 0, y: stick?.axes.y ?? 0 },
				agl(),
				dt,
				boost,
			);
			if (g.dy !== 0 || g.yaw !== 0) this.zoom?.cancel();
			if (g.yaw !== 0) this.move(yawAbout(g.yaw, [p.x, p.y, p.z]));
			if (g.dy !== 0) this.move({ yaw: 0, t: [0, g.dy, 0] });
		} else if (forward !== 0 || strafe !== 0) {
			this.zoom?.cancel();
			const v = gazeVelocity({ forward, strafe, boost }, gaze(), agl());
			this.move({ yaw: 0, t: [v[0] * dt, v[1] * dt, v[2] * dt] });
		}
		// Optional extra: left stick X snap-turns 30° about the head; turning the head/body works as well.
		const rx =
			left?.motionController?.getComponentOfType("thumbstick")?.axes.x ?? 0;
		const step = snapTurnStep(this.snap, rx);
		this.snap = step.state;
		if (step.turn) this.move(yawAbout(step.turn, [p.x, p.y, p.z]));
		// Trigger: smooth zoom toward the relief point under that controller's ray.
		for (const c of triggered) {
			c.getWorldPointerRayToRef(this.ray);
			const o = this.ray.origin;
			const d = this.ray.direction;
			const hit = this.host.hitRay([o.x, o.y, o.z], [d.x, d.y, d.z]);
			if (!hit) continue;
			const eye: Vec3 = [p.x, p.y, p.z];
			this.zoom = new ZoomTween(
				eye,
				zoomTarget(
					eye,
					hit,
					(x, z) => this.host.groundAt(x, z),
					this.host.bounds(),
				),
			);
			void c.motionController?.pulse(0.4, 40);
		}
		if (this.zoom) {
			this.move({ yaw: 0, t: this.zoom.step(dt) });
			if (this.zoom.done) this.zoom = null;
		}
		this.clamp();
		// The card travels with the user's rig.
		if (this.card?.visible) {
			const c = this.card.mesh.position;
			const q = applyRig(this.frameMove, [c.x, c.y, c.z]);
			c.set(q[0], q[1], q[2]);
		}
	}

	/**
	 * Maquette: one grip moves and turns the table, two grips scale it; the right stick turns it
	 * 30°; a right grip double press brings it back in front of you at its fitted size.
	 */
	private tableFrame(
		left: WebXRInputSource | undefined,
		right: WebXRInputSource | undefined,
	): void {
		if (!this.table) return;
		if (
			right &&
			this.pressedOnce(right, "xr-standard-squeeze", "squeeze") &&
			this.gripTap.press(performance.now() / 1000)
		) {
			this.tableGrab.reset();
			this.placeTableInFront();
			void right.motionController?.pulse(0.5, 80);
			return;
		}
		const held: GrabHand[] = [];
		for (const c of [left, right]) {
			if (!c?.motionController?.getComponentOfType("squeeze")?.pressed)
				continue;
			const p = (c.grip ?? c.pointer).absolutePosition;
			const f = c.pointer.forward;
			held.push({
				id: c.uniqueId,
				position: [p.x, p.y, p.z],
				yaw: controllerYaw([f.x, f.y, f.z]),
			});
		}
		this.table = this.tableGrab.step(
			this.table,
			held,
			tableScaleLimits(this.host.bounds()),
		);
		const rx =
			right?.motionController?.getComponentOfType("thumbstick")?.axes.x ?? 0;
		const step = snapTurnStep(this.tableSnap, rx);
		this.tableSnap = step.state;
		if (step.turn && !this.tableGrab.active)
			this.table = snapTurn(this.table, step.turn);
		this.host.setMapPlacement(mapRootFromPose(this.host.bounds(), this.table));
	}

	/** Switches the rig and the map root between flight and the table. */
	private applyView(view: VrView): void {
		this.view = view;
		this.zoom = null;
		this.tableGrab.reset();
		this.card?.hide();
		if (this.hintText) this.hintText.text = controlsHint(view);
		if (view === "maqueta") {
			// Real scale, untilted, standing at the origin: the map comes to the user, not the reverse.
			this.setTilt(false);
			const cam = this.xr.baseExperience.camera;
			cam.position.set(0, cam.realWorldHeight || 1.6, 0);
			this.tableSnap = { armed: true };
			this.placeTableInFront();
		} else {
			this.table = null;
			this.host.setMapPlacement(null);
			this.toStartView();
		}
	}

	private placeTableInFront(): void {
		const p = this.xr.baseExperience.camera.position;
		this.table = tableInFront(
			[p.x, p.y, p.z],
			this.headYaw(),
			this.host.bounds(),
		);
		this.host.setMapPlacement(mapRootFromPose(this.host.bounds(), this.table));
	}

	/** A marked the point: the card appears in front of the user. */
	private openCard(): void {
		if (!this.card) return;
		const cam = this.xr.baseExperience.camera;
		const head = cam.position;
		const g = cam.getDirection(Vector3.Forward());
		const up = cam.getDirection(Vector3.Up());
		this.cardError = null;
		this.card.showAt([
			head.x + g.x * CARD_DISTANCE - up.x * CARD_DROP,
			head.y + g.y * CARD_DISTANCE - up.y * CARD_DROP,
			head.z + g.z * CARD_DISTANCE - up.z * CARD_DROP,
		]);
		this.cardShown = "";
	}

	private closeCard(forget: boolean): void {
		if (this.cardBusy) return;
		this.card?.hide();
		this.cardError = null;
		if (forget) this.host.clearPick();
	}

	/** "Simular aquí" on the card: the web button's flow; on success the simulator takes the session. */
	private simulateFromCard(): void {
		if (this.cardBusy || !this.host.picked()) return;
		this.cardBusy = true;
		this.cardError = null;
		void this.host.simulatePicked().then((error) => {
			this.cardBusy = false;
			this.cardError = error;
			if (!error) this.card?.hide();
		});
	}

	/** Another simulator from the card (S5): it opens at its own origin and takes the session. */
	private openEntryFromCard(id: string): void {
		if (this.cardBusy) return;
		this.cardBusy = true;
		this.cardError = null;
		this.cardOpening =
			this.host.entries().find((entry) => entry.id === id)?.label ?? null;
		void this.host.openEntry(id).then((error) => {
			this.cardBusy = false;
			this.cardOpening = null;
			this.cardError = error;
			if (!error) this.card?.hide();
		});
	}

	private syncCard(): void {
		const card = this.card;
		if (!card?.visible) return;
		const picked = this.host.picked();
		if (!picked && !this.cardBusy) {
			card.hide();
			return;
		}
		const c = pointCardContent({
			picked,
			busy: this.cardBusy,
			error: this.cardError,
			view: this.view,
			entries: this.host.entries(),
			opening: this.cardOpening,
		});
		const key = JSON.stringify(c);
		if (key === this.cardShown) return;
		this.cardShown = key;
		card.update(c);
	}

	/**
	 * Start view (entering VR and grip double press): middle of the map, facing north, above the
	 * highest relief, with the map tilted toward the user (FLY.vrTiltDeg) about the heading's
	 * horizontal axis. Only yaw and that tilt are changed, never roll.
	 */
	private toStartView(): void {
		this.zoom = null;
		this.setTilt(false);
		const start = this.host.vrStart();
		this.card?.hide();
		this.turn(start.yaw - this.headYaw());
		this.xr.baseExperience.camera.position.set(...start.position);
		this.tiltHeading = start.yaw;
		this.setTilt(true);
		this.clamp();
	}

	/** Applies or removes the map tilt (rotation of the rig about the heading's horizontal axis). */
	private setTilt(on: boolean): void {
		if (this.tiltHeading === null) return;
		const angle = (FLY.vrTiltDeg * Math.PI) / 180;
		const [x, y, z] = vrTiltAxis(this.tiltHeading);
		const cam = this.xr.baseExperience.camera;
		cam.rotationQuaternion = Quaternion.RotationAxis(
			new Vector3(x, y, z),
			on ? angle : -angle,
		).multiply(cam.rotationQuaternion);
		if (!on) this.tiltHeading = null;
	}

	/** Moves the user's rig (head and controllers): yaw about the vertical, then translation. */
	private move(m: Rig): void {
		if (m.yaw === 0 && m.t[0] === 0 && m.t[1] === 0 && m.t[2] === 0) return;
		const cam = this.xr.baseExperience.camera;
		const p = applyRig(m, [cam.position.x, cam.position.y, cam.position.z]);
		if (m.yaw !== 0) {
			cam.rotationQuaternion = Quaternion.RotationAxis(
				Vector3.Up(),
				m.yaw,
			).multiply(cam.rotationQuaternion);
			if (this.tiltHeading !== null) this.tiltHeading += m.yaw;
		}
		cam.position.set(p[0], p[1], p[2]);
		this.frameMove = composeRig(this.frameMove, m);
	}

	private clamp(): void {
		const p = this.xr.baseExperience.camera.position;
		const [x, z] = clampToBounds(p.x, p.z, this.host.bounds());
		const y = clampAltitude(
			p.y,
			this.host.groundAt(x, z),
			1,
			FLY.clearance,
			FLY.maxAltitude,
		);
		this.move({ yaw: 0, t: [x - p.x, y - p.y, z - p.z] });
	}

	private headYaw(): number {
		const f = this.xr.baseExperience.camera.getDirection(Vector3.Forward());
		return Math.atan2(f.x, f.z);
	}

	/** Turns the user about the world vertical through the head (no roll). */
	private turn(angle: number): void {
		const cam = this.xr.baseExperience.camera;
		cam.rotationQuaternion = Quaternion.RotationAxis(
			Vector3.Up(),
			angle,
		).multiply(cam.rotationQuaternion);
		if (this.tiltHeading !== null) this.tiltHeading += angle;
	}

	private controller(handedness: XRHandedness): WebXRInputSource | undefined {
		return this.xr.input.controllers.find(
			(c) => c.inputSource.handedness === handedness,
		);
	}

	/** Rising edge of a button, by component id or, failing that, by component type. */
	private pressedOnce(
		input: WebXRInputSource,
		component: string,
		type?: MotionControllerComponentType,
	): boolean {
		const key = `${input.uniqueId}:${component}`;
		const mc = input.motionController;
		const now = !!(
			mc?.getComponent(component) ??
			(type ? mc?.getComponentOfType(type) : null)
		)?.pressed;
		const before = this.buttons.get(key) ?? false;
		this.buttons.set(key, now);
		return now && !before;
	}

	/** Small controls card above the right (flying) controller, always facing the user. */
	private attachHint(input: WebXRInputSource): void {
		if (!this.inXr || this.hint) return;
		const plane = MeshBuilder.CreatePlane(
			"peru-vr-hint",
			{ width: 0.24, height: 0.1, sideOrientation: Mesh.DOUBLESIDE },
			this.host.scene,
		);
		plane.isPickable = false;
		plane.parent = input.grip ?? input.pointer;
		plane.position.set(0, 0.09, 0.02);
		plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
		const ui = AdvancedDynamicTexture.CreateForMesh(plane, 960, 400, false);
		ui.background = "rgba(15, 18, 22, 0.85)";
		const text = new TextBlock("hint", controlsHint(this.view));
		text.color = "white";
		text.fontSize = 34;
		text.textWrapping = true;
		text.paddingLeft =
			text.paddingRight =
			text.paddingTop =
			text.paddingBottom =
				"20px";
		ui.addControl(text);
		this.hint = plane;
		this.hintText = text;
		// Attribution label right under the card (same controller), filled by syncCredit().
		// Tall enough for the imagery credit and the weather attribution (S8) together.
		const label = MeshBuilder.CreatePlane(
			"peru-vr-credit",
			{ width: 0.24, height: 0.07, sideOrientation: Mesh.DOUBLESIDE },
			this.host.scene,
		);
		label.isPickable = false;
		label.parent = plane.parent;
		label.position.set(0, 0.09 - 0.05 - 0.037, 0.02);
		label.billboardMode = Mesh.BILLBOARDMODE_ALL;
		const lui = AdvancedDynamicTexture.CreateForMesh(label, 960, 280, false);
		lui.background = "rgba(15, 18, 22, 0.85)";
		const ltext = new TextBlock("credit", "");
		ltext.color = "#c6ced8";
		ltext.fontSize = 22;
		ltext.textWrapping = true;
		ltext.paddingLeft = ltext.paddingRight = "16px";
		lui.addControl(ltext);
		label.setEnabled(false);
		this.credit = { mesh: label, text: ltext, shown: "" };
	}

	/** Shows the imagery attribution (+ prototype notice) and the weather attribution whenever they are visible. */
	private syncCredit(): void {
		if (!this.credit) return;
		const c = this.host.imageryCredit();
		const wx = this.host.weatherCredit();
		const text = [
			c ? (c.notice ? `${c.text}\n${c.notice}` : c.text) : "",
			wx ?? "",
		]
			.filter(Boolean)
			.join("\n");
		if (text === this.credit.shown) return;
		this.credit.shown = text;
		this.credit.text.text = text;
		this.credit.text.color = c?.notice ? "#ffcf70" : "#c6ced8";
		this.credit.mesh.setEnabled(!!text);
	}
}
