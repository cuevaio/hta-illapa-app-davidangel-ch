import {
	type Color3,
	Color4,
	type LinesMesh,
	Matrix,
	Mesh,
	MeshBuilder,
	type Scene,
	type TransformNode,
	Vector3,
	Viewport,
} from "@babylonjs/core";
import {
	AdvancedDynamicTexture,
	Control,
	type Rectangle,
	TextBlock,
} from "@babylonjs/gui";
import {
	formatStructureLength,
	structureGradePercent,
	structureLengthM,
} from "@hack-the-andes-project/business/structures/geometry";
import type { BabylonTerrain } from "@hack-the-andes-project/terrain/babylon/types";
import type { LocalPoint } from "@hack-the-andes-project/terrain/types";
import type {
	BabylonStructureSceneProps,
	SceneStructure,
} from "../../lib/structure-scene";
import { modelFramePoints, type SceneCamera } from "./camera";
import {
	CHIP_FRACTION_DIGITS_COUNT,
	EXPOSURE_RING_SEGMENTS_COUNT,
	GRID_CELL_M,
	GRID_FADE_DISTANCE_M,
	GRID_LIFT_M,
	GRID_MAJOR_CELL_M,
	GRID_MAJOR_OPACITY_RATIO,
	GRID_MINOR_OPACITY_RATIO,
	GRID_SIZE_M,
	HALF_RATIO,
	INCIDENT_INK_TOKEN_NAMES,
	INCIDENT_TOKEN_NAMES,
	LABEL_FONT_SIZE_PX,
	LABEL_HEIGHT_PX,
	LABEL_LIFT_M,
	LANDMARK_CLEARANCE_PX,
	LANDMARK_FADE_DISTANCE_M,
	LANDMARK_LIFT_M,
	LANDMARK_MAX_DISTANCE_M,
	MARKER_LIFT_M,
	MAX_VISIBLE_INCIDENT_MARKERS_COUNT,
} from "./constants";
import { createLabelPill } from "./label-pill";
import type { ScenePalette, StructureModel } from "./models";

interface LinkedLabel {
	anchor: Mesh;
	control: Rectangle;
	landmark: boolean;
}

export function structureMeasurements(
	structure: SceneStructure,
	props: BabylonStructureSceneProps,
): string {
	const template = structure.template;
	const length = formatStructureLength(
		structureLengthM(template),
		props.locale,
	);
	const formatter = new Intl.NumberFormat(props.locale, {
		maximumFractionDigits: CHIP_FRACTION_DIGITS_COUNT,
	});
	if (template.kind === "bridge")
		return `${props.labels.span} ${length} · ${props.labels.heightDifference} ${formatter.format(Math.abs(template.end.y - template.start.y))} m`;
	if (template.kind === "tunnel")
		return `${props.labels.length} ${length} · ${props.labels.slope} ${formatter.format(structureGradePercent(template))} %`;
	return template.kind === "bypass" ? `${props.labels.length} ${length}` : "";
}

export class SceneLabels {
	readonly texture: AdvancedDynamicTexture;
	private readonly labels: LinkedLabel[] = [];
	private readonly status: TextBlock;
	private readonly projection = new Vector3();
	private readonly selectedProjection = new Vector3();
	private readonly viewport = new Viewport(0, 0, 1, 1);
	private selectedAnchor: Mesh | null = null;

	constructor(
		private readonly scene: Scene,
		private readonly terrain: BabylonTerrain,
		private readonly parent: TransformNode,
	) {
		this.texture = AdvancedDynamicTexture.CreateFullscreenUI(
			"structure-labels",
			true,
			scene,
		);
		this.texture.renderScale = scene.getEngine().getHardwareScalingLevel();
		const resizeObserver = scene.getEngine().onResizeObservable.add(() => {
			this.texture.renderScale = scene.getEngine().getHardwareScalingLevel();
		});
		this.texture.onDisposeObservable.addOnce(() =>
			scene.getEngine().onResizeObservable.remove(resizeObserver),
		);
		this.status = new TextBlock("terrain-status");
		this.status.fontSize = LABEL_FONT_SIZE_PX;
		this.status.heightInPixels = LABEL_HEIGHT_PX;
		this.status.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
		this.status.isPointerBlocker = false;
		this.texture.addControl(this.status);
	}

	rebuild(
		props: BabylonStructureSceneProps,
		models: Map<string, StructureModel>,
		palette: ScenePalette,
	) {
		for (const label of this.labels) {
			label.control.dispose();
			label.anchor.dispose();
		}
		this.labels.length = 0;
		this.selectedAnchor = null;
		for (const structure of props.structures) {
			const model = models.get(structure.id);
			if (!model) continue;
			const points = modelFramePoints(model);
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
			const center = minimum.add(maximum).scaleInPlace(HALF_RATIO);
			center.y =
				Math.max(maximum.y, this.terrain.heightAt(center) ?? maximum.y) +
				LABEL_LIFT_M;
			const selected = structure.id === props.selectedStructureId;
			const label = this.add(
				structure.name,
				center,
				palette.css(selected ? "--primary" : "--foreground"),
				palette.css("--card"),
				palette.css(selected ? "--ring" : "--muted-foreground"),
			);
			label.control.zIndex = selected ? 2 : 1;
			if (selected) this.selectedAnchor = label.anchor;
		}
		for (const landmark of props.landmarks) {
			const local = this.terrain.toLocal(landmark);
			const elevationM = this.terrain.heightAt(local);
			if (elevationM === null) continue;
			const label = this.add(
				landmark.name,
				new Vector3(local.x, elevationM + LANDMARK_LIFT_M, local.z),
				palette.css("--muted-foreground"),
				"transparent",
				"transparent",
			);
			label.landmark = true;
			label.control.zIndex = 0;
		}
		for (const incident of props.incidentMarkers.slice(
			0,
			MAX_VISIBLE_INCIDENT_MARKERS_COUNT,
		)) {
			const local = this.terrain.toLocal(incident.point);
			const elevationM = this.terrain.heightAt(local);
			if (elevationM === null) continue;
			const label = this.add(
				`${incident.severity} · ${incident.label}`,
				new Vector3(local.x, elevationM + MARKER_LIFT_M, local.z),
				palette.css(INCIDENT_INK_TOKEN_NAMES[incident.severity]),
				palette.css(INCIDENT_TOKEN_NAMES[incident.severity]),
				palette.css("--card"),
			);
			label.control.zIndex = 3;
			label.control.cornerRadius = LABEL_HEIGHT_PX;
		}
		this.status.color = palette.css("--foreground");
	}

	add(
		text: string,
		position: Vector3,
		color: string,
		background: string,
		border: string,
	): LinkedLabel {
		const anchor = new Mesh("label-anchor", this.scene);
		anchor.parent = this.parent;
		anchor.position.copyFrom(position);
		anchor.isPickable = false;
		anchor.isVisible = false;
		anchor.computeWorldMatrix(true);
		const { control } = createLabelPill(
			"structure-label",
			text,
			color,
			background,
			border,
		);
		this.texture.addControl(control);
		control.linkWithMesh(anchor);
		const label = { anchor, control, landmark: false };
		this.labels.push(label);
		return label;
	}

	setStatus(message: string) {
		this.status.text = message;
	}
	setVisible(visible: boolean) {
		this.texture.rootContainer.isVisible = visible;
	}

	tick(camera: SceneCamera) {
		const engine = this.scene.getEngine();
		const viewport = this.viewport;
		viewport.x = camera.camera.viewport.x * engine.getRenderWidth();
		viewport.y = camera.camera.viewport.y * engine.getRenderHeight();
		viewport.width = camera.camera.viewport.width * engine.getRenderWidth();
		viewport.height = camera.camera.viewport.height * engine.getRenderHeight();
		if (this.selectedAnchor)
			Vector3.ProjectToRef(
				this.selectedAnchor.position,
				Matrix.IdentityReadOnly,
				this.scene.getTransformMatrix(),
				viewport,
				this.selectedProjection,
			);
		for (const label of this.labels) {
			if (!label.landmark) continue;
			const distanceM = Vector3.Distance(
				camera.camera.position,
				label.anchor.position,
			);
			Vector3.ProjectToRef(
				label.anchor.position,
				Matrix.IdentityReadOnly,
				this.scene.getTransformMatrix(),
				viewport,
				this.projection,
			);
			const selectedClearancePx = this.selectedAnchor
				? Math.hypot(
						this.projection.x - this.selectedProjection.x,
						this.projection.y - this.selectedProjection.y,
					) * engine.getHardwareScalingLevel()
				: Number.POSITIVE_INFINITY;
			label.control.isVisible =
				distanceM < LANDMARK_MAX_DISTANCE_M &&
				selectedClearancePx > LANDMARK_CLEARANCE_PX;
			label.control.alpha = Math.max(
				0,
				Math.min(
					1,
					(LANDMARK_MAX_DISTANCE_M - distanceM) /
						(LANDMARK_MAX_DISTANCE_M - LANDMARK_FADE_DISTANCE_M),
				),
			);
		}
	}

	dispose() {
		for (const label of this.labels) label.anchor.dispose();
		this.texture.dispose();
	}
}

export class TerrainGrid {
	private mesh: LinesMesh | null = null;
	private readonly lines: Vector3[][] = [];
	private readonly colors: Color4[][] = [];
	private readonly sample = { x: 0, z: 0 };

	constructor(
		private readonly scene: Scene,
		private readonly terrain: BabylonTerrain,
		private readonly parent: TransformNode,
	) {
		for (let axis = 0; axis < 2; axis++) {
			for (let line = 0; line <= GRID_SIZE_M / GRID_CELL_M; line++) {
				for (let segment = 0; segment < GRID_SIZE_M / GRID_CELL_M; segment++) {
					this.lines.push([new Vector3(), new Vector3()]);
					this.colors.push([new Color4(), new Color4()]);
				}
			}
		}
	}

	update(center: LocalPoint | null, color: Color3, visible: boolean) {
		if (!center || !visible) {
			this.mesh?.setEnabled(false);
			return;
		}
		const centerX = Math.round(center.x / GRID_CELL_M) * GRID_CELL_M;
		const centerZ = Math.round(center.z / GRID_CELL_M) * GRID_CELL_M;
		let lineIndex = 0;
		for (let axis = 0; axis < 2; axis++) {
			for (let line = 0; line <= GRID_SIZE_M / GRID_CELL_M; line++) {
				for (let segment = 0; segment < GRID_SIZE_M / GRID_CELL_M; segment++) {
					const points = this.lines[lineIndex];
					const colors = this.colors[lineIndex];
					if (!points || !colors) continue;
					for (let endpoint = 0; endpoint < 2; endpoint++) {
						const eastOffsetM =
							(axis === 0 ? segment + endpoint : line) * GRID_CELL_M -
							GRID_SIZE_M * HALF_RATIO;
						const southOffsetM =
							(axis === 0 ? line : segment + endpoint) * GRID_CELL_M -
							GRID_SIZE_M * HALF_RATIO;
						this.sample.x = centerX + eastOffsetM;
						this.sample.z = centerZ + southOffsetM;
						const heightM = this.terrain.heightAt(this.sample);
						const fade = Math.min(
							1,
							(GRID_SIZE_M * HALF_RATIO -
								Math.max(Math.abs(eastOffsetM), Math.abs(southOffsetM))) /
								GRID_FADE_DISTANCE_M,
						);
						const major =
							(axis === 0 ? this.sample.z : this.sample.x) %
								GRID_MAJOR_CELL_M ===
							0;
						points[endpoint]?.set(
							this.sample.x,
							(heightM ?? 0) + GRID_LIFT_M,
							this.sample.z,
						);
						colors[endpoint]?.set(
							color.r,
							color.g,
							color.b,
							heightM === null
								? 0
								: fade *
										(major
											? GRID_MAJOR_OPACITY_RATIO
											: GRID_MINOR_OPACITY_RATIO),
						);
					}
					if (colors.some((vertex) => vertex.a === 0))
						for (const vertex of colors) vertex.a = 0;
					lineIndex++;
				}
			}
		}
		this.mesh = MeshBuilder.CreateLineSystem(
			"terrain-grid",
			{
				lines: this.lines,
				colors: this.colors,
				updatable: true,
				instance: this.mesh ?? undefined,
				useVertexAlpha: true,
			},
			this.scene,
		);
		this.mesh.parent = this.parent;
		this.mesh.isPickable = false;
		this.mesh.setEnabled(true);
	}

	setVisible(visible: boolean) {
		this.mesh?.setEnabled(visible);
	}
	dispose() {
		this.mesh?.dispose();
	}
}

export function createExposureRing(
	scene: Scene,
	terrain: BabylonTerrain,
	center: LocalPoint,
	radiusM: number,
	parent: TransformNode,
	color: Color3,
): LinesMesh | null {
	const lines: Vector3[][] = [];
	let previous: Vector3 | null = null;
	for (let segment = 0; segment <= EXPOSURE_RING_SEGMENTS_COUNT; segment++) {
		const angleRad = (segment / EXPOSURE_RING_SEGMENTS_COUNT) * Math.PI * 2;
		const point = new Vector3(
			center.x + Math.cos(angleRad) * radiusM,
			0,
			center.z + Math.sin(angleRad) * radiusM,
		);
		const heightM = terrain.heightAt(point);
		if (heightM === null) {
			previous = null;
			continue;
		}
		point.y = heightM + GRID_LIFT_M;
		if (previous) lines.push([previous, point]);
		previous = point;
	}
	if (!lines.length) return null;
	const ring = MeshBuilder.CreateLineSystem("exposure-ring", { lines }, scene);
	ring.parent = parent;
	ring.color = color;
	ring.isPickable = false;
	return ring;
}
