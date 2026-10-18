import {
	type AbstractMesh,
	Color4,
	DirectionalLight,
	HemisphericLight,
	type LinesMesh,
	Matrix,
	PointerEventTypes,
	Ray,
	Scene,
	TransformNode,
	Vector3,
} from "@babylonjs/core";
import { MAX_STRUCTURE_ELEMENTS } from "@hack-the-andes-project/business/structures/constants";
import { terrainGradient } from "@hack-the-andes-project/business/structures/placement";
import type { BabylonTerrain } from "@hack-the-andes-project/terrain/babylon/types";
import type {
	SceneCursor,
	SceneStructure,
	StructureSceneProps,
	TerrainStatus,
} from "../../lib/structure-scene";
import { SceneCamera } from "./camera";
import {
	CLICK_THRESHOLD_PX,
	CURSOR_REPORT_INTERVAL_MS,
	DRAG_CLICK_SUPPRESSION_MS,
	FOG_END_M,
	FOG_START_M,
	GHOST_OPACITY_RATIO,
	GRID_CELL_M,
	HANDLE_RENDER_GROUP_ID,
	HEIGHT_CHANGE_EPSILON_M,
	HOVER_OPACITY_RATIO,
	SKY_INTENSITY_RATIO,
	SUN_DIRECTION_M,
	SUN_INTENSITY_RATIO,
	TERRAIN_REFRESH_INTERVAL_MS,
	TUNNEL_TERRAIN_OPACITY_RATIO,
	XR_CLICK_THRESHOLD_M,
} from "./constants";
import { SceneEditing } from "./editing";
import {
	createStructureModel,
	type ScenePalette,
	type StructureModel,
} from "./models";
import { createExposureRing, SceneLabels, TerrainGrid } from "./overlays";
import { createPlacement, relativePoint } from "./placement";
import { TerrainPointerSurface } from "./terrain-pointer-surface";
import { collectTerrainSamples, type TerrainSample } from "./terrain-samples";

interface OverlayChanges {
	labels: boolean;
	editing: boolean;
	ring: boolean;
	grid: boolean;
}

interface MeshTarget {
	structureId: string;
	elementId: string | null;
}

interface PointerStart {
	clientX: number;
	clientY: number;
	worldPoint: Vector3 | null;
	moved: boolean;
	button: number;
}

export class StructureSceneRuntime {
	readonly content: TransformNode;
	readonly models = new Map<string, StructureModel>();
	readonly camera: SceneCamera;
	readonly labels: SceneLabels;
	readonly editing: SceneEditing;
	private readonly structuresRoot: TransformNode;
	private readonly meshTargets = new Map<AbstractMesh, MeshTarget>();
	private readonly sources = new Map<string, SceneStructure>();
	private readonly terrainSamples = new Map<string, TerrainSample[]>();
	private readonly starts = new Map<number, PointerStart>();
	private readonly grid: TerrainGrid;
	private readonly inverseWorld = Matrix.Identity();
	private readonly pointerRay = new Ray(Vector3.Zero(), Vector3.Zero());
	private readonly sky: HemisphericLight;
	private readonly sun: DirectionalLight;
	private cursor: Vector3 | null = null;
	private lastReportedPoint: Vector3 | null = null;
	private lastReportedCursor: SceneCursor | null = null;
	private draft: SceneStructure | null = null;
	private ghost: StructureModel | null = null;
	private ring: LinesMesh | null = null;
	private hoveredId: string | null = null;
	private suppressClickUntilMs = 0;
	private lastCursorMs = Number.NEGATIVE_INFINITY;
	private lastRefreshMs = Number.NEGATIVE_INFINITY;
	private gridX = Number.NaN;
	private gridZ = Number.NaN;
	private terrainDirty = true;
	private overlaysDirty = true;
	private props: StructureSceneProps;
	private palette: ScenePalette;
	private status: TerrainStatus = "loading";
	private presenting = false;
	private disposed = false;
	private initialized = false;

	constructor(
		readonly scene: Scene,
		readonly terrain: BabylonTerrain,
		props: StructureSceneProps,
		palette: ScenePalette,
	) {
		this.props = props;
		this.palette = palette;
		this.content = new TransformNode("structure-world", scene);
		scene.setRenderingOrder(
			HANDLE_RENDER_GROUP_ID,
			(left, right) => left.getMesh().alphaIndex - right.getMesh().alphaIndex,
		);
		terrain.root.parent = this.content;
		new TerrainPointerSurface(scene, terrain);
		this.structuresRoot = new TransformNode("structures", scene);
		this.structuresRoot.parent = this.content;
		this.camera = new SceneCamera(scene, terrain);
		this.labels = new SceneLabels(scene, terrain, this.content);
		this.grid = new TerrainGrid(scene, terrain, this.content);
		this.sky = new HemisphericLight("sky", Vector3.Up(), scene);
		this.sky.intensity = SKY_INTENSITY_RATIO;
		this.sun = new DirectionalLight(
			"sun",
			new Vector3(SUN_DIRECTION_M.x, SUN_DIRECTION_M.y, SUN_DIRECTION_M.z),
			scene,
		);
		this.sun.intensity = SUN_INTENSITY_RATIO;
		this.editing = new SceneEditing({
			scene,
			terrain,
			parent: this.content,
			camera: this.camera,
			linkLabel: (control, mesh) => {
				this.labels.texture.addControl(control);
				control.linkWithMesh(mesh);
			},
			getProps: () => this.props,
			onDraft: (draft) => {
				if (this.disposed) return;
				this.draft = draft;
				this.syncModels();
				this.overlaysDirty = true;
				if (!draft) this.refreshOverlays();
			},
			onDragging: (dragging) => {
				if (this.disposed) return;
				this.suppressClickUntilMs = dragging
					? Number.POSITIVE_INFINITY
					: performance.now() + DRAG_CLICK_SUPPRESSION_MS;
				if (dragging) this.camera.camera.detachControl();
				else if (!this.presenting) this.camera.camera.attachControl(false);
				const canvas = this.scene.getEngine().getRenderingCanvas();
				if (canvas) canvas.style.cursor = dragging ? "grabbing" : "";
			},
		});
		scene.onPointerObservable.add(
			(info, eventState) => {
				if (this.disposed || !scene.activeCamera || !this.content.isEnabled())
					return;
				const event = info.event;
				const pointerId =
					"pointerId" in event && typeof event.pointerId === "number"
						? event.pointerId
						: 0;
				const picking = info.pickInfo;
				if (
					picking?.pickedMesh &&
					picking.pickedMesh.getScene() !== scene &&
					!this.editing.dragging
				)
					return;
				if (!picking?.ray)
					scene.createPickingRayToRef(
						scene.pointerX,
						scene.pointerY,
						null,
						this.pointerRay,
						scene.activeCamera,
					);
				const ray = picking?.ray ?? this.pointerRay;
				if (event.type === "pointercancel") {
					this.editing.cancel();
					this.starts.delete(pointerId);
					return;
				}
				if (
					info.type === PointerEventTypes.POINTERDOWN ||
					info.type === PointerEventTypes.POINTERWHEEL
				)
					this.camera.cancel();
				if (info.type === PointerEventTypes.POINTERWHEEL) return;
				if (
					info.type !== PointerEventTypes.POINTERMOVE &&
					info.type !== PointerEventTypes.POINTERDOWN &&
					info.type !== PointerEventTypes.POINTERUP
				)
					return;
				const modelPick = scene.pickWithRay(
					ray,
					(mesh) =>
						this.meshTargets.has(mesh) &&
						mesh.isEnabled() &&
						mesh.isVisible &&
						mesh.isPickable,
				);
				const terrainPoint = terrain.pick(ray);
				const modelPoint = modelPick?.pickedPoint;
				const terrainWorldPoint = terrainPoint
					? Vector3.TransformCoordinates(
							terrainPoint,
							this.content.getWorldMatrix(),
						)
					: null;
				const worldPoint = modelPoint ?? terrainWorldPoint;
				const modelIsNearest =
					Boolean(modelPoint) &&
					(!terrainWorldPoint ||
						Vector3.DistanceSquared(ray.origin, terrainWorldPoint) >=
							(modelPick?.distance ?? Number.POSITIVE_INFINITY) ** 2);
				const target = modelPick?.pickedMesh
					? this.meshTargets.get(modelPick.pickedMesh)
					: undefined;
				if (info.type === PointerEventTypes.POINTERDOWN) {
					this.starts.set(pointerId, {
						clientX: event.clientX,
						clientY: event.clientY,
						worldPoint: worldPoint?.clone() ?? null,
						moved: false,
						button: event.button,
					});
					if (event.button === 0 && !this.props.placementTool) {
						const handlePick = scene.pickWithRay(
							ray,
							(mesh) =>
								this.editing.targets.has(mesh) &&
								mesh.isEnabled() &&
								mesh.isVisible &&
								mesh.isPickable,
						);
						const handle = handlePick?.pickedMesh
							? this.editing.targets.get(handlePick.pickedMesh)
							: undefined;
						if (handle && this.editing.begin(handle, pointerId)) {
							this.suppressClickUntilMs = this.editing.dragging
								? Number.POSITIVE_INFINITY
								: performance.now() + DRAG_CLICK_SUPPRESSION_MS;
							eventState.skipNextObservers = true;
							return;
						}
					}
				}
				if (info.type === PointerEventTypes.POINTERMOVE) {
					const start = this.starts.get(pointerId);
					if (
						start &&
						Math.hypot(
							event.clientX - start.clientX,
							event.clientY - start.clientY,
						) >= CLICK_THRESHOLD_PX
					)
						start.moved = true;
					if (this.editing.dragging) {
						this.editing.move(ray, pointerId);
						eventState.skipNextObservers = true;
						return;
					}
					this.setHover(
						this.props.placementTool ? null : (target?.structureId ?? null),
					);
					const handlePick = this.props.placementTool
						? null
						: scene.pickWithRay(ray, (mesh) => this.editing.targets.has(mesh));
					this.editing.hover(handlePick?.pickedMesh ?? null);
					const canvas = this.scene.getEngine().getRenderingCanvas();
					if (canvas)
						canvas.style.cursor = this.props.placementTool
							? "crosshair"
							: handlePick?.hit
								? "grab"
								: target
									? "pointer"
									: "";
					this.cursor = terrainPoint;
					if (
						this.props.placementTool &&
						"primitive" in this.props.placementTool &&
						modelPoint &&
						modelIsNearest
					) {
						this.content.getWorldMatrix().invertToRef(this.inverseWorld);
						this.cursor = Vector3.TransformCoordinates(
							modelPoint,
							this.inverseWorld,
						);
					}
				}
				if (info.type !== PointerEventTypes.POINTERUP) return;
				if (this.editing.end(pointerId)) {
					this.starts.delete(pointerId);
					eventState.skipNextObservers = true;
					return;
				}
				const start = this.starts.get(pointerId);
				this.starts.delete(pointerId);
				if (
					start?.button !== 0 ||
					start.moved ||
					(!this.presenting &&
						Math.hypot(
							event.clientX - start.clientX,
							event.clientY - start.clientY,
						) >= CLICK_THRESHOLD_PX) ||
					this.editing.gizmo.isHovered ||
					this.editing.gizmo.isDragging ||
					performance.now() < this.suppressClickUntilMs
				)
					return;
				if (
					this.presenting &&
					start.worldPoint &&
					worldPoint &&
					Vector3.Distance(start.worldPoint, worldPoint) > XR_CLICK_THRESHOLD_M
				)
					return;
				if (this.props.placementTool) {
					let point = terrainPoint;
					if (
						"primitive" in this.props.placementTool &&
						modelPoint &&
						modelIsNearest
					) {
						this.content.getWorldMatrix().invertToRef(this.inverseWorld);
						point = Vector3.TransformCoordinates(modelPoint, this.inverseWorld);
					}
					if (!point || !this.canPlace()) return;
					const placed = createPlacement(
						terrain,
						point,
						this.props.placementTool,
					);
					const selected = this.selected();
					if (
						"primitive" in this.props.placementTool &&
						this.props.primitiveTarget === "selection" &&
						selected
					) {
						const element = placed.elements[0];
						if (element)
							this.props.onStructureChange({
								...selected,
								elements: [
									...selected.elements,
									{
										...element,
										position: relativePoint(terrain, selected, point),
									},
								],
							});
					} else this.props.onCreateStructure(placed);
				} else if (target) {
					this.props.onSelectStructure(target.structureId);
					this.props.onSelectElement(
						target.structureId === this.props.selectedStructureId
							? target.elementId
							: null,
					);
				} else if (terrainPoint) {
					this.props.onSelectElement(null);
					this.props.onSelectStructure(null);
				}
			},
			-1,
			true,
		);
		scene.onBeforeRenderObservable.add(() => this.tick());
		this.update(props, palette);
	}

	private selected() {
		return (
			this.draft ??
			this.props.structures.find(
				(structure) => structure.id === this.props.selectedStructureId,
			) ??
			null
		);
	}
	private canPlace() {
		const selected = this.selected();
		return !(
			this.props.placementTool &&
			"primitive" in this.props.placementTool &&
			this.props.primitiveTarget === "selection" &&
			selected &&
			selected.elements.length >= MAX_STRUCTURE_ELEMENTS
		);
	}

	update(props: StructureSceneProps, palette: ScenePalette) {
		const previous = this.props;
		const firstUpdate = !this.initialized;
		this.initialized = true;
		const paletteChanged = firstUpdate || this.palette !== palette;
		const modelsChanged =
			firstUpdate || paletteChanged || props.structures !== previous.structures;
		const selectionChanged =
			firstUpdate || props.selectedStructureId !== previous.selectedStructureId;
		const placementChanged =
			firstUpdate ||
			JSON.stringify(props.placementTool) !==
				JSON.stringify(previous.placementTool);
		const labelsChanged =
			firstUpdate ||
			props.locale !== previous.locale ||
			Object.values(props.labels).join("\0") !==
				Object.values(previous.labels).join("\0");
		const editingChanged =
			modelsChanged ||
			selectionChanged ||
			placementChanged ||
			labelsChanged ||
			props.selectedElementId !== previous.selectedElementId ||
			props.transformMode !== previous.transformMode;
		const incidentsChanged =
			props.incidentMarkers.length !== previous.incidentMarkers.length ||
			props.incidentMarkers.some((marker, index) => {
				const previousMarker = previous.incidentMarkers[index];
				return (
					marker.id !== previousMarker?.id ||
					marker.label !== previousMarker.label ||
					marker.severity !== previousMarker.severity ||
					marker.point.lat !== previousMarker.point.lat ||
					marker.point.lng !== previousMarker.point.lng
				);
			});
		const landmarksChanged =
			props.landmarks.length !== previous.landmarks.length ||
			props.landmarks.some((landmark, index) => {
				const previousLandmark = previous.landmarks[index];
				return (
					landmark.name !== previousLandmark?.name ||
					landmark.lat !== previousLandmark.lat ||
					landmark.lng !== previousLandmark.lng
				);
			});
		const ringChanged =
			props.exposureRing?.structureId !== previous.exposureRing?.structureId ||
			props.exposureRing?.radiusM !== previous.exposureRing?.radiusM;
		if (
			this.editing.dragging &&
			(selectionChanged ||
				placementChanged ||
				props.selectedElementId !== previous.selectedElementId ||
				props.transformMode !== previous.transformMode)
		)
			this.editing.cancel();
		this.props = props;
		this.palette = palette;
		if (paletteChanged) {
			this.sources.clear();
			const background = palette.color("--background");
			this.scene.clearColor = new Color4(
				background.r,
				background.g,
				background.b,
				1,
			);
			this.scene.fogMode = Scene.FOGMODE_LINEAR;
			this.scene.fogColor = background;
			this.scene.fogStart = FOG_START_M;
			this.scene.fogEnd = FOG_END_M;
			const foreground = palette.color("--foreground");
			const card = palette.color("--card");
			const lightColor =
				foreground.r + foreground.g + foreground.b > card.r + card.g + card.b
					? foreground
					: card;
			this.sky.diffuse = lightColor;
			this.sky.groundColor = palette.color("--muted");
			this.sun.diffuse = lightColor;
		}
		if (modelsChanged || selectionChanged)
			this.terrain.setOpacity(
				this.selected()?.template.kind === "tunnel"
					? TUNNEL_TERRAIN_OPACITY_RATIO
					: 1,
			);
		if (modelsChanged) this.syncModels();
		else if (
			selectionChanged ||
			props.selectedElementId !== previous.selectedElementId ||
			props.hoveredStructureId !== previous.hoveredStructureId
		)
			this.highlight();
		this.refreshOverlays({
			labels:
				modelsChanged ||
				selectionChanged ||
				labelsChanged ||
				incidentsChanged ||
				landmarksChanged,
			editing: editingChanged,
			ring: modelsChanged || ringChanged,
			grid: modelsChanged || selectionChanged || placementChanged,
		});
		if (
			modelsChanged ||
			placementChanged ||
			props.primitiveTarget !== previous.primitiveTarget
		)
			this.refreshGhost();
		this.refreshStatus();
		this.camera.update(props, this.models, this.presenting);
	}

	private syncModels() {
		for (const [structureId, model] of this.models) {
			if (
				this.props.structures.some((structure) => structure.id === structureId)
			)
				continue;
			for (const mesh of model.meshes) this.meshTargets.delete(mesh);
			model.dispose();
			this.models.delete(structureId);
			this.sources.delete(structureId);
			this.terrainSamples.delete(structureId);
		}
		for (const source of this.props.structures) {
			const structure = this.draft?.id === source.id ? this.draft : source;
			if (this.sources.get(source.id) === structure) continue;
			const previous = this.models.get(source.id);
			if (previous) {
				for (const mesh of previous.meshes) this.meshTargets.delete(mesh);
				previous.dispose();
			}
			const model = createStructureModel(
				this.scene,
				structure,
				this.terrain,
				this.palette,
				this.structuresRoot,
			);
			this.models.set(source.id, model);
			this.sources.set(source.id, structure);
			this.terrainSamples.set(
				source.id,
				collectTerrainSamples(structure, this.terrain),
			);
			for (const mesh of model.meshes) {
				if (!mesh.isPickable) continue;
				let elementId: string | null = null;
				for (const [candidateId, node] of model.elements)
					if (mesh.parent === node) elementId = candidateId;
				this.meshTargets.set(mesh, { structureId: source.id, elementId });
			}
		}
		this.highlight();
	}

	private highlight() {
		for (const [structureId, model] of this.models) {
			const selected = structureId === this.props.selectedStructureId;
			const hovered =
				structureId === this.hoveredId ||
				structureId === this.props.hoveredStructureId;
			model.outline(
				selected
					? this.palette.color("--ring")
					: hovered
						? this.palette.color("--foreground")
						: null,
				selected ? 1 : HOVER_OPACITY_RATIO,
				selected ? this.props.selectedElementId : null,
			);
		}
	}

	private setHover(structureId: string | null) {
		if (this.hoveredId === structureId) return;
		this.hoveredId = structureId;
		this.highlight();
		const canvas = this.scene.getEngine().getRenderingCanvas();
		if (canvas)
			canvas.style.cursor = this.props.placementTool
				? "crosshair"
				: structureId
					? "pointer"
					: "";
	}

	private refreshGhost() {
		this.ghost?.dispose();
		this.ghost = null;
		if (
			!this.props.placementTool ||
			!this.cursor ||
			this.presenting ||
			!this.canPlace()
		)
			return;
		const placement = createPlacement(
			this.terrain,
			this.cursor,
			this.props.placementTool,
			"preview",
		);
		this.ghost = createStructureModel(
			this.scene,
			placement,
			this.terrain,
			this.palette,
			this.content,
			GHOST_OPACITY_RATIO,
		);
	}

	private refreshOverlays(
		changes: OverlayChanges = {
			labels: true,
			editing: true,
			ring: true,
			grid: true,
		},
	) {
		if (changes.labels) this.overlaysDirty = false;
		if (changes.labels)
			this.labels.rebuild(
				this.draft
					? {
							...this.props,
							structures: this.props.structures.map((structure) =>
								structure.id === this.draft?.id ? this.draft : structure,
							),
						}
					: this.props,
				this.models,
				this.palette,
			);
		this.refreshStatus();
		const selected = this.selected();
		if (changes.editing)
			this.editing.rebuild(
				selected,
				selected ? this.models.get(selected.id) : undefined,
				this.palette,
				this.presenting,
			);
		if (changes.ring) {
			this.ring?.dispose();
			this.ring = null;
			const exposure = this.props.exposureRing;
			const structure = this.props.structures.find(
				(structure) => structure.id === exposure?.structureId,
			);
			if (exposure && structure)
				this.ring = createExposureRing(
					this.scene,
					this.terrain,
					this.terrain.toLocal(structure.anchor),
					exposure.radiusM,
					this.content,
					this.palette.color("--ring"),
				);
		}
		if (changes.grid) this.updateGrid();
	}

	private refreshStatus() {
		this.labels.setStatus(
			this.status === "error"
				? this.props.labels.terrainError
				: this.props.placementTool && (!this.cursor || !this.canPlace())
					? this.props.labels.outsideTerrain
					: "",
		);
	}

	private updateGrid() {
		const selected = this.selected();
		const center = this.props.placementTool
			? this.cursor
			: selected
				? this.terrain.toLocal(selected.anchor)
				: null;
		this.gridX = center ? Math.round(center.x / GRID_CELL_M) : Number.NaN;
		this.gridZ = center ? Math.round(center.z / GRID_CELL_M) : Number.NaN;
		this.grid.update(
			center,
			this.palette.color("--foreground"),
			!this.presenting,
		);
	}

	markTerrainDirty() {
		this.terrainDirty = true;
	}
	clearPointer() {
		this.editing.cancel();
		this.editing.hover(null);
		this.cursor = null;
		this.setHover(null);
		this.starts.clear();
		this.refreshGhost();
		this.updateGrid();
		this.refreshStatus();
	}
	setStatus(status: TerrainStatus) {
		if (this.disposed || this.status === status) return;
		this.status = status;
		this.refreshStatus();
		this.props.onTerrainStatusChange(status);
	}
	setPresenting(active: boolean) {
		this.editing.cancel();
		this.presenting = active;
		this.labels.setVisible(!active);
		this.grid.setVisible(!active);
		this.refreshGhost();
		this.refreshOverlays();
		if (active) this.camera.cancel();
		else this.camera.camera.attachControl(false);
	}

	private tick() {
		if (this.disposed) return;
		const camera = this.scene.activeCamera;
		if (camera) this.terrain.update(camera);
		this.camera.tick(this.props.insets, this.presenting);
		this.editing.tick(this.presenting);
		if (!this.presenting) this.labels.tick(this.camera);
		const nowMs = performance.now();
		if (nowMs - this.lastCursorMs >= CURSOR_REPORT_INTERVAL_MS) {
			this.lastCursorMs = nowMs;
			if (!this.cursor) {
				if (this.lastReportedCursor) this.props.onCursorChange(null);
				if (this.lastReportedPoint) {
					this.refreshGhost();
					this.updateGrid();
					this.refreshStatus();
				}
				this.lastReportedCursor = null;
				this.lastReportedPoint = null;
			} else if (
				!this.lastReportedPoint ||
				Vector3.DistanceSquared(this.cursor, this.lastReportedPoint) >
					HEIGHT_CHANGE_EPSILON_M ** 2
			) {
				this.lastReportedPoint = this.cursor.clone();
				this.lastReportedCursor = {
					point: this.terrain.toGeo(this.cursor),
					elevationM: this.cursor.y,
					slopePercent: terrainGradient(this.cursor, (point) =>
						this.terrain.heightAt(point),
					).slopePercent,
				};
				this.props.onCursorChange(this.lastReportedCursor);
				this.refreshGhost();
				this.refreshStatus();
			}
			if (
				this.props.placementTool &&
				this.cursor &&
				(Math.round(this.cursor.x / GRID_CELL_M) !== this.gridX ||
					Math.round(this.cursor.z / GRID_CELL_M) !== this.gridZ)
			)
				this.updateGrid();
		}
		if (nowMs - this.lastRefreshMs >= TERRAIN_REFRESH_INTERVAL_MS) {
			this.lastRefreshMs = nowMs;
			if (this.terrainDirty && !this.editing.dragging) {
				this.terrainDirty = false;
				for (const [structureId, samples] of this.terrainSamples) {
					for (const sample of samples) {
						const heightM = this.terrain.heightAt(sample);
						if (
							heightM === null || sample.heightM === null
								? heightM !== sample.heightM
								: Math.abs(heightM - sample.heightM) > HEIGHT_CHANGE_EPSILON_M
						)
							this.sources.delete(structureId);
					}
				}
				this.syncModels();
				this.overlaysDirty = true;
				if (this.terrain.heightAt({ x: 0, z: 0 }) !== null)
					this.setStatus("ready");
			}
			if (this.overlaysDirty) this.refreshOverlays();
		}
	}

	dispose() {
		this.disposed = true;
		this.editing.dispose();
		this.labels.dispose();
		this.grid.dispose();
		this.ghost?.dispose();
		this.ring?.dispose();
		for (const model of this.models.values()) model.dispose();
		this.terrain.dispose();
		this.content.dispose();
		this.sky.dispose();
		this.sun.dispose();
		this.props.onCursorChange(null);
	}
}
