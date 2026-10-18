import {
	ArcRotateCamera,
	ArcRotateCameraMouseWheelInput,
	Matrix,
	type Scene,
	Vector3,
	Viewport,
} from "@babylonjs/core";
import type { BabylonTerrain } from "@hack-the-andes-project/terrain/babylon/types";
import type {
	SceneInsets,
	StructureSceneProps,
} from "../../lib/structure-scene";
import {
	CAMERA_FAR_DISTANCE_RATIO,
	CAMERA_FAR_M,
	CAMERA_FLIGHT_DURATION_MS,
	CAMERA_FLIGHT_EASE_EXPONENT,
	CAMERA_FOCUS_FILL_RATIO,
	CAMERA_FOV_RAD,
	CAMERA_FRAME_ITERATIONS_COUNT,
	CAMERA_GROUND_CLAMP_ITERATIONS_COUNT,
	CAMERA_GROUND_CLEARANCE_EPSILON_M,
	CAMERA_GROUND_CLEARANCE_M,
	CAMERA_GROUND_CLEARANCE_RATIO,
	CAMERA_INERTIA_RATIO,
	CAMERA_INITIAL_ALPHA_RAD,
	CAMERA_INITIAL_BETA_RAD,
	CAMERA_INITIAL_RADIUS_M,
	CAMERA_MAX_BETA_RAD,
	CAMERA_MAX_RADIUS_M,
	CAMERA_MIN_BETA_RAD,
	CAMERA_MIN_FAR_M,
	CAMERA_MIN_RADIUS_M,
	CAMERA_NEAR_DISTANCE_RATIO,
	CAMERA_NEAR_M,
	CAMERA_OVERVIEW_FILL_RATIO,
	CAMERA_SLOPED_FRAME_BETA_RAD,
	CAMERA_SLOPED_FRAME_MIN_GRADE_RATIO,
	CAMERA_WHEEL_PERCENTAGE_RATIO,
	EXPOSURE_RING_SEGMENTS_COUNT,
	HALF_RATIO,
	INITIAL_ELEVATION_M,
	MIN_GEOMETRY_LENGTH_M,
} from "./constants";
import type { StructureModel } from "./models";

export interface CameraFrame {
	target: Vector3;
	position: Vector3;
}

interface CameraFlight extends CameraFrame {
	fromTarget: Vector3;
	fromPosition: Vector3;
	startedAtMs: number;
}

export function modelFramePoints(model: StructureModel): Vector3[] {
	const points: Vector3[] = [];
	for (const mesh of model.meshes) {
		mesh.computeWorldMatrix(true);
		points.push(
			...mesh
				.getBoundingInfo()
				.boundingBox.vectorsWorld.map((point) => point.clone()),
		);
	}
	return points.length ? points : [model.root.getAbsolutePosition().clone()];
}

export function framePoints(
	points: Vector3[],
	insets: SceneInsets,
	widthPx: number,
	heightPx: number,
	fillRatio = CAMERA_FOCUS_FILL_RATIO,
): CameraFrame {
	const minimum = new Vector3(
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	);
	const maximum = new Vector3(
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	);
	for (const point of points) {
		minimum.minimizeInPlace(point);
		maximum.maximizeInPlace(point);
	}
	const target = minimum.add(maximum).scaleInPlace(HALF_RATIO);
	const horizontalExtentM = Math.hypot(
		maximum.x - minimum.x,
		maximum.z - minimum.z,
	);
	const betaRad =
		(maximum.y - minimum.y) /
			Math.max(MIN_GEOMETRY_LENGTH_M, horizontalExtentM) >=
		CAMERA_SLOPED_FRAME_MIN_GRADE_RATIO
			? CAMERA_SLOPED_FRAME_BETA_RAD
			: CAMERA_INITIAL_BETA_RAD;
	const direction = new Vector3(
		Math.sin(betaRad) * Math.cos(CAMERA_INITIAL_ALPHA_RAD),
		Math.cos(betaRad),
		Math.sin(betaRad) * Math.sin(CAMERA_INITIAL_ALPHA_RAD),
	);
	const viewport = new Viewport(0, 0, widthPx, heightPx);
	const projection = Matrix.PerspectiveFovRH(
		CAMERA_FOV_RAD,
		widthPx / Math.max(1, heightPx),
		CAMERA_NEAR_M,
		CAMERA_FAR_M,
	);
	const freeWidthPx = Math.max(1, widthPx - insets.leftPx - insets.rightPx);
	const freeHeightPx = Math.max(1, heightPx - insets.topPx - insets.bottomPx);
	let minimumRadiusM = CAMERA_MIN_RADIUS_M;
	let maximumRadiusM = CAMERA_MAX_RADIUS_M;
	for (
		let iteration = 0;
		iteration < CAMERA_FRAME_ITERATIONS_COUNT;
		iteration++
	) {
		const radiusM = (minimumRadiusM + maximumRadiusM) * HALF_RATIO;
		const position = target.add(direction.scale(radiusM));
		const view = Matrix.LookAtRH(position, target, Vector3.Up());
		const transform = view.multiply(projection);
		let minimumEastPx = Number.POSITIVE_INFINITY;
		let maximumEastPx = Number.NEGATIVE_INFINITY;
		let minimumNorthPx = Number.POSITIVE_INFINITY;
		let maximumNorthPx = Number.NEGATIVE_INFINITY;
		let behindCamera = false;
		for (const point of points) {
			if (Vector3.TransformCoordinates(point, view).z >= -CAMERA_NEAR_M)
				behindCamera = true;
			const screen = Vector3.Project(
				point,
				Matrix.IdentityReadOnly,
				transform,
				viewport,
			);
			minimumEastPx = Math.min(minimumEastPx, screen.x);
			maximumEastPx = Math.max(maximumEastPx, screen.x);
			minimumNorthPx = Math.min(minimumNorthPx, screen.y);
			maximumNorthPx = Math.max(maximumNorthPx, screen.y);
		}
		if (
			behindCamera ||
			Math.max(
				(maximumEastPx - minimumEastPx) / freeWidthPx,
				(maximumNorthPx - minimumNorthPx) / freeHeightPx,
			) > fillRatio
		)
			minimumRadiusM = radiusM;
		else maximumRadiusM = radiusM;
	}
	return { target, position: target.add(direction.scale(maximumRadiusM)) };
}

export class SceneCamera {
	readonly camera: ArcRotateCamera;
	private flight: CameraFlight | null = null;
	private handledRequestId: number | undefined;
	private trackingOrigin = true;
	private initialFrameApplied = false;
	private readonly nextTarget = new Vector3();
	private readonly nextPosition = new Vector3();

	constructor(
		private readonly scene: Scene,
		private readonly terrain: BabylonTerrain,
	) {
		this.camera = new ArcRotateCamera(
			"structure-camera",
			CAMERA_INITIAL_ALPHA_RAD,
			CAMERA_INITIAL_BETA_RAD,
			CAMERA_INITIAL_RADIUS_M,
			new Vector3(
				0,
				terrain.heightAt({ x: 0, z: 0 }) ?? INITIAL_ELEVATION_M,
				0,
			),
			scene,
		);
		this.camera.fov = CAMERA_FOV_RAD;
		this.camera.minZ = CAMERA_NEAR_M;
		this.camera.maxZ = CAMERA_FAR_M;
		this.camera.lowerRadiusLimit = CAMERA_MIN_RADIUS_M;
		this.camera.upperRadiusLimit = CAMERA_MAX_RADIUS_M;
		this.camera.lowerBetaLimit = CAMERA_MIN_BETA_RAD;
		this.camera.upperBetaLimit = CAMERA_MAX_BETA_RAD;
		this.camera.allowUpsideDown = false;
		this.camera.inertia = CAMERA_INERTIA_RATIO;
		this.camera.wheelDeltaPercentage = CAMERA_WHEEL_PERCENTAGE_RATIO;
		this.camera.attachControl(false);
		this.camera.movement.input.addEntry({
			source: "pointer",
			button: 0,
			modifiers: { shift: true },
			interaction: "pan",
		});
		const wheel = this.camera.inputs.attached.mousewheel;
		if (wheel instanceof ArcRotateCameraMouseWheelInput)
			wheel.zoomToMouseLocation = true;
	}

	cancel() {
		this.flight = null;
		this.trackingOrigin = false;
	}

	update(
		props: StructureSceneProps,
		models: Map<string, StructureModel>,
		presenting: boolean,
	) {
		if (presenting) {
			this.flight = null;
			return;
		}
		const engine = this.scene.getEngine();
		const widthPx = engine.getRenderWidth() * engine.getHardwareScalingLevel();
		const heightPx =
			engine.getRenderHeight() * engine.getHardwareScalingLevel();
		if (!this.initialFrameApplied) {
			this.initialFrameApplied = true;
			const points = [...models.values()].flatMap(modelFramePoints);
			if (points.length) {
				const frame = framePoints(
					points,
					props.insets,
					widthPx,
					heightPx,
					CAMERA_OVERVIEW_FILL_RATIO,
				);
				this.camera.setTarget(frame.target);
				this.camera.setPosition(frame.position);
				this.trackingOrigin = false;
			}
		}
		const request = props.cameraRequest;
		if (request && this.handledRequestId !== request.requestId) {
			this.handledRequestId = request.requestId;
			this.cancel();
			let points: Vector3[] = [];
			if (request.kind === "overview")
				points = [...models.values()].flatMap(modelFramePoints);
			else if (request.kind === "focus_point") {
				const local = this.terrain.toLocal(request.point);
				points = [
					new Vector3(
						local.x,
						this.terrain.heightAt(local) ?? this.camera.target.y,
						local.z,
					),
				];
			} else if (request.kind !== "north_up") {
				const model = models.get(request.structureId);
				if (model) points = modelFramePoints(model);
				if (request.kind === "frame_exposure" && model) {
					const center = model.root.position;
					for (
						let segment = 0;
						segment < EXPOSURE_RING_SEGMENTS_COUNT;
						segment++
					) {
						const angleRad =
							(segment / EXPOSURE_RING_SEGMENTS_COUNT) * Math.PI * 2;
						const point = new Vector3(
							center.x + Math.cos(angleRad) * request.radiusM,
							center.y,
							center.z + Math.sin(angleRad) * request.radiusM,
						);
						point.y = this.terrain.heightAt(point) ?? point.y;
						points.push(point);
					}
				}
			}
			let frame: CameraFrame | null = points.length
				? framePoints(
						points,
						props.insets,
						widthPx,
						heightPx,
						request.kind === "overview"
							? CAMERA_OVERVIEW_FILL_RATIO
							: CAMERA_FOCUS_FILL_RATIO,
					)
				: null;
			if (request.kind === "overview" && !points.length)
				frame = {
					target: new Vector3(
						0,
						this.terrain.heightAt({ x: 0, z: 0 }) ?? INITIAL_ELEVATION_M,
						0,
					),
					position: new Vector3(
						CAMERA_INITIAL_RADIUS_M,
						INITIAL_ELEVATION_M + CAMERA_INITIAL_RADIUS_M,
						CAMERA_INITIAL_RADIUS_M,
					),
				};
			if (request.kind === "north_up") {
				const offset = this.camera.position.subtract(this.camera.target);
				frame = {
					target: this.camera.target.clone(),
					position: this.camera.target.add(
						new Vector3(0, offset.y, Math.hypot(offset.x, offset.z)),
					),
				};
			}
			if (frame) {
				this.camera.inertialAlphaOffset = 0;
				this.camera.inertialBetaOffset = 0;
				this.camera.inertialRadiusOffset = 0;
				this.camera.inertialPanningX = 0;
				this.camera.inertialPanningY = 0;
				if (
					typeof matchMedia !== "undefined" &&
					matchMedia("(prefers-reduced-motion: reduce)").matches
				) {
					this.camera.setTarget(frame.target);
					this.camera.setPosition(frame.position);
				} else
					this.flight = {
						...frame,
						fromTarget: this.camera.target.clone(),
						fromPosition: this.camera.position.clone(),
						startedAtMs: performance.now(),
					};
			}
		}
		this.constrainToTerrain();
	}

	private constrainToTerrain() {
		for (
			let iteration = 0;
			iteration < CAMERA_GROUND_CLAMP_ITERATIONS_COUNT;
			iteration++
		) {
			this.camera.getViewMatrix(true);
			const groundM = this.terrain.heightAt(this.camera.position);
			if (groundM === null) return;
			const scaledClearanceM =
				this.camera.radius * CAMERA_GROUND_CLEARANCE_RATIO;
			const clearanceM = Math.max(CAMERA_GROUND_CLEARANCE_M, scaledClearanceM);
			if (this.camera.position.y >= groundM + clearanceM) return;
			// Raising the camera increases its radius, so the lift must also cover that added clearance.
			const liftM = Math.max(
				groundM + CAMERA_GROUND_CLEARANCE_M - this.camera.position.y,
				(groundM + scaledClearanceM - this.camera.position.y) /
					(1 - CAMERA_GROUND_CLEARANCE_RATIO),
			);
			this.nextPosition.copyFrom(this.camera.position);
			this.nextPosition.y += liftM + CAMERA_GROUND_CLEARANCE_EPSILON_M;
			this.camera.setPosition(this.nextPosition);
			this.camera.inertialBetaOffset = 0;
			this.camera.inertialRadiusOffset = 0;
		}
		this.camera.getViewMatrix(true);
	}

	tick(insets: SceneInsets, presenting: boolean) {
		if (presenting) return;
		if (this.trackingOrigin) {
			const heightM = this.terrain.heightAt(this.camera.target);
			if (heightM !== null) this.camera.target.y = heightM;
		}
		if (this.flight) {
			const progress = Math.min(
				1,
				(performance.now() - this.flight.startedAtMs) /
					CAMERA_FLIGHT_DURATION_MS,
			);
			const eased = 1 - (1 - progress) ** CAMERA_FLIGHT_EASE_EXPONENT;
			Vector3.LerpToRef(
				this.flight.fromTarget,
				this.flight.target,
				eased,
				this.nextTarget,
			);
			Vector3.LerpToRef(
				this.flight.fromPosition,
				this.flight.position,
				eased,
				this.nextPosition,
			);
			this.camera.setTarget(this.nextTarget);
			this.camera.setPosition(this.nextPosition);
			if (progress === 1) this.flight = null;
		}
		this.constrainToTerrain();
		this.camera.minZ = Math.max(
			CAMERA_NEAR_M,
			this.camera.radius * CAMERA_NEAR_DISTANCE_RATIO,
		);
		this.camera.maxZ = Math.max(
			CAMERA_MIN_FAR_M,
			Math.min(CAMERA_FAR_M, this.camera.radius * CAMERA_FAR_DISTANCE_RATIO),
		);
		const heightPx =
			this.scene.getEngine().getRenderHeight() *
			this.scene.getEngine().getHardwareScalingLevel();
		const metresPerPx =
			(this.camera.radius * Math.tan(this.camera.fov * HALF_RATIO) * 2) /
			Math.max(1, heightPx);
		this.camera.targetScreenOffset.set(
			(insets.leftPx - insets.rightPx) * HALF_RATIO * metresPerPx,
			(insets.bottomPx - insets.topPx) * HALF_RATIO * metresPerPx,
		);
	}
}
