import {
	type AbstractMesh,
	Constants,
	GizmoManager,
	Mesh,
	MeshBuilder,
	type Ray,
	type Scene,
	StandardMaterial,
	TransformNode,
	Vector3,
} from "@babylonjs/core";
import { type Control, Rectangle, TextBlock } from "@babylonjs/gui";
import {
	BYPASS_PARAMETERS,
	PRIMITIVE_SIZE_RANGE_M,
} from "@hack-the-andes-project/business/structures/catalog";
import { MAX_BYPASS_POINTS } from "@hack-the-andes-project/business/structures/constants";
import type { BabylonTerrain } from "@hack-the-andes-project/terrain/babylon/types";
import type {
	SceneStructure,
	StructureElement,
	StructurePoint,
	StructureSceneProps,
} from "../../lib/structure-scene";
import type { SceneCamera } from "./camera";
import {
	DEGREES_PER_RADIAN,
	HALF_RATIO,
	HANDLE_BORDER_PX,
	HANDLE_CHIP_OFFSET_PX,
	HANDLE_GLYPH_SIZE_PX,
	HANDLE_GLYPH_STROKE_PX,
	HANDLE_HIT_SIZE_PX,
	HANDLE_HOVER_SIZE_PX,
	HANDLE_INSERT_SIZE_PX,
	HANDLE_LABEL_OFFSET_PX,
	HANDLE_LIFT_M,
	HANDLE_RENDER_GROUP_ID,
	HANDLE_SEGMENTS_COUNT,
	HANDLE_SIZE_PX,
	LABEL_FONT_SIZE_PX,
	LABEL_HEIGHT_PX,
	LABEL_WIDTH_PX,
	ROTATION_SNAP_DEG,
	SCALE_SNAP_M,
	TRANSLATION_SNAP_M,
	XR_HANDLE_METRES_PER_PX,
} from "./constants";
import { createLabelPill, type LabelPill } from "./label-pill";
import type { ScenePalette, StructureModel } from "./models";
import { structureMeasurements } from "./overlays";
import { clampPoint, snapHandlePoint } from "./placement";
import { elementRotation, elementRotationDegrees } from "./transforms";

export interface HandleTarget {
	index: number;
	insert: boolean;
	remove: boolean;
}

interface HandleDrag {
	pointerId: number;
	original: SceneStructure;
	draft: SceneStructure;
	target: HandleTarget;
	inserted: boolean;
}

interface HandleView {
	root: TransformNode;
	caption: Rectangle;
	mesh: Mesh;
}

export interface EditingOptions {
	scene: Scene;
	terrain: BabylonTerrain;
	parent: TransformNode;
	camera: SceneCamera;
	linkLabel(control: Control, mesh: Mesh): void;
	getProps(): StructureSceneProps;
	onDraft(draft: SceneStructure | null): void;
	onDragging(dragging: boolean): void;
}

export class SceneEditing {
	readonly targets = new Map<AbstractMesh, HandleTarget>();
	readonly gizmo: GizmoManager;
	private readonly views: HandleView[] = [];
	private drag: HandleDrag | null = null;
	private selected: SceneStructure | null = null;
	private element: StructureElement | null = null;
	private elementNode: TransformNode | null = null;
	private gizmoDraft: SceneStructure | null = null;
	private hoveredMesh: AbstractMesh | null = null;
	private readonly handleRoot: TransformNode;
	private readonly materials: StandardMaterial[] = [];
	private readonly worldPosition = new Vector3();
	private readonly worldScale = new Vector3();
	private readonly observedGizmos = new Set<object>();
	private dragChip: LabelPill | null = null;
	private presenting = false;

	constructor(private readonly options: EditingOptions) {
		this.handleRoot = new TransformNode("structure-handles", options.scene);
		this.handleRoot.parent = options.parent;
		this.gizmo = new GizmoManager(options.scene);
		this.gizmo.usePointerToAttachGizmos = false;
		this.gizmo.clearGizmoOnEmptyPointerEvent = false;
		this.gizmo.enableAutoPicking = false;
	}

	get dragging() {
		return (
			Boolean(this.drag) || Boolean(this.gizmoDraft) || this.gizmo.isDragging
		);
	}

	rebuild(
		structure: SceneStructure | null,
		model: StructureModel | undefined,
		palette: ScenePalette,
		presenting: boolean,
	) {
		if (this.dragging) return;
		this.presenting = presenting;
		this.selected = structure;
		this.clearHandles();
		const props = this.options.getProps();
		const enabled = Boolean(structure) && !props.placementTool;
		if (structure && enabled) this.buildHandles(structure, palette);
		this.element =
			structure?.elements.find(
				(element) => element.id === props.selectedElementId,
			) ?? null;
		this.elementNode = this.element
			? (model?.elements.get(this.element.id) ?? null)
			: null;
		const gizmoEnabled = enabled && Boolean(this.elementNode) && !presenting;
		this.gizmo.positionGizmoEnabled =
			gizmoEnabled && props.transformMode === "translate";
		this.gizmo.rotationGizmoEnabled =
			gizmoEnabled && props.transformMode === "rotate";
		this.gizmo.scaleGizmoEnabled =
			gizmoEnabled && props.transformMode === "scale";
		this.gizmo.attachToNode(gizmoEnabled ? this.elementNode : null);
		const position = this.gizmo.gizmos.positionGizmo;
		if (position) position.snapDistance = TRANSLATION_SNAP_M;
		const rotation = this.gizmo.gizmos.rotationGizmo;
		if (rotation) {
			rotation.snapDistance = ROTATION_SNAP_DEG / DEGREES_PER_RADIAN;
			rotation.xGizmo.isEnabled = false;
			rotation.zGizmo.isEnabled = false;
			rotation.updateGizmoRotationToMatchAttachedMesh = false;
		}
		const scale = this.gizmo.gizmos.scaleGizmo;
		if (scale) {
			scale.snapDistance = 0;
			scale.incrementalSnap = true;
		}
		for (const gizmo of [position, rotation, scale]) {
			if (!gizmo || this.observedGizmos.has(gizmo)) continue;
			this.observedGizmos.add(gizmo);
			gizmo.onDragStartObservable.add(() => {
				this.options.camera.cancel();
				this.gizmoDraft = this.selected;
				this.options.onDragging(true);
			});
			gizmo.onDragObservable.add(() => {
				if (!this.selected || !this.element || !this.elementNode) return;
				const node = this.elementNode;
				const dimensions = {
					widthM: Math.max(
						PRIMITIVE_SIZE_RANGE_M.min,
						Math.min(
							PRIMITIVE_SIZE_RANGE_M.max,
							Math.round(
								(this.element.widthM * node.scaling.x) / SCALE_SNAP_M,
							) * SCALE_SNAP_M,
						),
					),
					heightM: Math.max(
						PRIMITIVE_SIZE_RANGE_M.min,
						Math.min(
							PRIMITIVE_SIZE_RANGE_M.max,
							Math.round(
								(this.element.heightM * node.scaling.y) / SCALE_SNAP_M,
							) * SCALE_SNAP_M,
						),
					),
					depthM: Math.max(
						PRIMITIVE_SIZE_RANGE_M.min,
						Math.min(
							PRIMITIVE_SIZE_RANGE_M.max,
							Math.round(
								(this.element.depthM * node.scaling.z) / SCALE_SNAP_M,
							) * SCALE_SNAP_M,
						),
					),
				};
				const mode = this.options.getProps().transformMode;
				const rotationDeg =
					mode === "rotate" && node.rotationQuaternion
						? elementRotationDegrees(node.rotationQuaternion)
						: this.element.rotationDeg;
				if (mode === "scale")
					node.scaling.set(
						dimensions.widthM / this.element.widthM,
						dimensions.heightM / this.element.heightM,
						dimensions.depthM / this.element.depthM,
					);
				if (mode === "translate") {
					const position = clampPoint({
						x:
							Math.round(node.position.x / TRANSLATION_SNAP_M) *
							TRANSLATION_SNAP_M,
						y:
							Math.round(node.position.y / TRANSLATION_SNAP_M) *
							TRANSLATION_SNAP_M,
						z:
							Math.round(node.position.z / TRANSLATION_SNAP_M) *
							TRANSLATION_SNAP_M,
					});
					node.position.set(position.x, position.y, position.z);
				}
				const changed: StructureElement = {
					...this.element,
					position: clampPoint(node.position),
					rotationDeg,
					...(mode === "scale" ? dimensions : {}),
				};
				this.gizmoDraft = {
					...this.selected,
					elements: this.selected.elements.map((element) =>
						element.id === changed.id ? changed : element,
					),
				};
			});
			gizmo.onDragEndObservable.add(() => {
				const draft = this.gizmoDraft;
				this.gizmoDraft = null;
				this.options.onDragging(false);
				if (draft && draft !== this.selected)
					this.options.getProps().onStructureChange(draft);
				this.options.onDraft(null);
			});
		}
	}

	private buildHandles(structure: SceneStructure, palette: ScenePalette) {
		const props = this.options.getProps();
		const template = structure.template;
		const anchor = this.options.terrain.toLocal(structure.anchor);
		this.handleRoot.position.set(
			anchor.x,
			structure.anchor.elevationM,
			anchor.z,
		);
		const points =
			template.kind === "entity"
				? []
				: template.kind === "bypass"
					? template.points
					: [template.start, template.end];
		const handles: { point: StructurePoint; target: HandleTarget }[] =
			points.map((point, index) => ({
				point,
				target: { index, insert: false, remove: false },
			}));
		if (template.kind === "bypass" && points.length < MAX_BYPASS_POINTS) {
			for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
				const previous = points[pointIndex - 1];
				const next = points[pointIndex];
				if (previous && next)
					handles.push({
						point: {
							x: (previous.x + next.x) * HALF_RATIO,
							y: (previous.y + next.y) * HALF_RATIO,
							z: (previous.z + next.z) * HALF_RATIO,
						},
						target: { index: pointIndex, insert: true, remove: false },
					});
			}
		}
		const fill = new StandardMaterial("handle-fill", this.options.scene);
		fill.disableLighting = true;
		fill.emissiveColor = palette.color("--card");
		fill.disableDepthWrite = true;
		fill.depthFunction = Constants.ALWAYS;
		fill.backFaceCulling = false;
		const border = fill.clone("handle-border");
		border.emissiveColor = palette.color("--ring");
		const destructive = fill.clone("remove-point-ink");
		destructive.emissiveColor = palette.color("--destructive");
		const hitMaterial = new StandardMaterial("handle-hit", this.options.scene);
		hitMaterial.alpha = 0;
		hitMaterial.disableDepthWrite = true;
		this.materials.push(fill, border, destructive, hitMaterial);
		for (const handle of handles) {
			const root = new TransformNode("handle", this.options.scene);
			root.parent = this.handleRoot;
			root.position.set(
				handle.point.x,
				handle.point.y + HANDLE_LIFT_M,
				handle.point.z,
			);
			root.billboardMode = Mesh.BILLBOARDMODE_ALL;
			const hit = MeshBuilder.CreateDisc(
				"handle-hit",
				{
					radius: HANDLE_HIT_SIZE_PX * HALF_RATIO,
					tessellation: HANDLE_SEGMENTS_COUNT,
					sideOrientation: Mesh.DOUBLESIDE,
				},
				this.options.scene,
			);
			hit.parent = root;
			hit.material = hitMaterial;
			hit.renderingGroupId = HANDLE_RENDER_GROUP_ID;
			this.targets.set(hit, handle.target);
			const disc = MeshBuilder.CreateDisc(
				"handle-disc",
				{
					radius:
						(handle.target.insert ? HANDLE_INSERT_SIZE_PX : HANDLE_SIZE_PX) *
						HALF_RATIO,
					tessellation: HANDLE_SEGMENTS_COUNT,
					sideOrientation: Mesh.DOUBLESIDE,
				},
				this.options.scene,
			);
			disc.parent = root;
			disc.material = border;
			disc.isPickable = false;
			disc.renderingGroupId = HANDLE_RENDER_GROUP_ID;
			const inner = MeshBuilder.CreateDisc(
				"handle-inner",
				{
					radius:
						(handle.target.insert ? HANDLE_INSERT_SIZE_PX : HANDLE_SIZE_PX) *
							HALF_RATIO -
						HANDLE_BORDER_PX,
					tessellation: HANDLE_SEGMENTS_COUNT,
					sideOrientation: Mesh.DOUBLESIDE,
				},
				this.options.scene,
			);
			inner.parent = root;
			inner.material = fill;
			inner.isPickable = false;
			inner.renderingGroupId = HANDLE_RENDER_GROUP_ID;
			inner.alphaIndex = 1;
			if (handle.target.insert) this.addGlyph(root, border, false);
			const caption = new Rectangle("handle-caption");
			caption.widthInPixels = LABEL_WIDTH_PX;
			caption.heightInPixels = LABEL_HEIGHT_PX;
			caption.thickness = 0;
			caption.isPointerBlocker = false;
			caption.isVisible = false;
			const name =
				template.kind === "bridge"
					? `${props.labels.abutment} ${handle.target.index === 0 ? "A" : "B"}`
					: template.kind === "tunnel"
						? `${props.labels.portal} ${handle.target.index === 0 ? "A" : "B"}`
						: `${props.labels.point} ${handle.target.index + 1}`;
			const text = new TextBlock(
				"handle-name",
				handle.target.insert ? "" : name,
			);
			text.fontSize = LABEL_FONT_SIZE_PX;
			text.color = palette.css(
				handle.target.insert ? "--foreground" : "--ring",
			);
			caption.addControl(text);
			this.options.linkLabel(caption, hit);
			caption.linkOffsetY = handle.target.insert ? 0 : HANDLE_LABEL_OFFSET_PX;
			this.views.push({ root, mesh: hit, caption });
			if (
				template.kind === "bypass" &&
				points.length > BYPASS_PARAMETERS.minPointCount &&
				!handle.target.insert
			) {
				const remove = MeshBuilder.CreateDisc(
					"remove-point",
					{
						radius: HANDLE_HIT_SIZE_PX * HALF_RATIO,
						tessellation: HANDLE_SEGMENTS_COUNT,
						sideOrientation: Mesh.DOUBLESIDE,
					},
					this.options.scene,
				);
				remove.parent = root;
				remove.position.x = HANDLE_HIT_SIZE_PX;
				remove.material = hitMaterial;
				remove.renderingGroupId = HANDLE_RENDER_GROUP_ID;
				this.targets.set(remove, { ...handle.target, remove: true });
				const removeDisc = MeshBuilder.CreateDisc(
					"remove-point-disc",
					{
						radius: HANDLE_SIZE_PX * HALF_RATIO,
						tessellation: HANDLE_SEGMENTS_COUNT,
						sideOrientation: Mesh.DOUBLESIDE,
					},
					this.options.scene,
				);
				removeDisc.parent = remove;
				removeDisc.material = fill;
				removeDisc.isPickable = false;
				removeDisc.renderingGroupId = HANDLE_RENDER_GROUP_ID;
				this.addGlyph(remove, destructive, true);
			}
		}
		const firstHandle = this.views[0];
		if (firstHandle) {
			this.dragChip = createLabelPill(
				"handle-drag-chip",
				"",
				palette.css("--foreground"),
				palette.css("--card"),
				palette.css("--ring"),
			);
			this.dragChip.control.isVisible = false;
			this.dragChip.control.linkOffsetY = `${-HANDLE_CHIP_OFFSET_PX}px`;
			this.options.linkLabel(this.dragChip.control, firstHandle.mesh);
		}
	}

	hover(mesh: AbstractMesh | null) {
		this.hoveredMesh = mesh;
	}

	private addGlyph(
		parent: TransformNode,
		material: StandardMaterial,
		remove: boolean,
	) {
		for (const vertical of remove ? [false] : [false, true]) {
			const stroke = MeshBuilder.CreateBox(
				"handle-glyph",
				{
					width: vertical ? HANDLE_GLYPH_STROKE_PX : HANDLE_GLYPH_SIZE_PX,
					height: vertical ? HANDLE_GLYPH_SIZE_PX : HANDLE_GLYPH_STROKE_PX,
					depth: HANDLE_GLYPH_STROKE_PX,
				},
				this.options.scene,
			);
			stroke.parent = parent;
			stroke.material = material;
			stroke.isPickable = false;
			stroke.renderingGroupId = HANDLE_RENDER_GROUP_ID;
			stroke.alphaIndex = 2;
		}
	}

	begin(target: HandleTarget, pointerId: number): boolean {
		if (!this.selected || this.dragging) return false;
		if (target.remove) {
			const template = this.selected.template;
			if (
				template.kind === "bypass" &&
				template.points.length > BYPASS_PARAMETERS.minPointCount
			)
				this.options.getProps().onStructureChange({
					...this.selected,
					template: {
						...template,
						points: template.points.filter(
							(_, index) => index !== target.index,
						),
					},
				});
			return true;
		}
		this.gizmo.attachToNode(null);
		this.drag = {
			pointerId,
			original: this.selected,
			draft: this.selected,
			target,
			inserted: false,
		};
		const activeHandle = this.views.find((view) => {
			const candidate = this.targets.get(view.mesh);
			return (
				candidate?.index === target.index && candidate.insert === target.insert
			);
		});
		if (this.dragChip && activeHandle) {
			this.dragChip.caption.text = structureMeasurements(
				this.selected,
				this.options.getProps(),
			);
			this.dragChip.control.linkWithMesh(activeHandle.mesh);
			this.dragChip.control.isVisible = !this.presenting;
		}
		this.options.camera.cancel();
		this.options.onDragging(true);
		return true;
	}

	move(ray: Ray, pointerId: number) {
		if (!this.drag || this.drag.pointerId !== pointerId) return;
		const hit = this.options.terrain.pick(ray);
		if (!hit) return;
		const point = snapHandlePoint(
			this.options.terrain,
			this.drag.original,
			hit,
		);
		if (!point) return;
		const template = this.drag.draft.template;
		if (template.kind === "entity") return;
		if (template.kind === "bypass") {
			const points = [...template.points];
			if (this.drag.target.insert && !this.drag.inserted) {
				if (points.length >= MAX_BYPASS_POINTS) return;
				points.splice(this.drag.target.index, 0, point);
				this.drag.inserted = true;
			} else points[this.drag.target.index] = point;
			this.drag.draft = {
				...this.drag.draft,
				template: { ...template, points },
			};
		} else
			this.drag.draft = {
				...this.drag.draft,
				template: {
					...template,
					[this.drag.target.index === 0 ? "start" : "end"]: point,
				},
			};
		const view = this.views.find((view) => {
			const target = this.targets.get(view.mesh);
			return (
				target?.index === this.drag?.target.index &&
				target?.insert === this.drag?.target.insert
			);
		});
		view?.root.position.set(point.x, point.y + HANDLE_LIFT_M, point.z);
		if (this.dragChip)
			this.dragChip.caption.text = structureMeasurements(
				this.drag.draft,
				this.options.getProps(),
			);
		this.options.onDraft(this.drag.draft);
	}

	end(pointerId: number) {
		if (!this.drag || this.drag.pointerId !== pointerId) return false;
		const drag = this.drag;
		this.drag = null;
		if (this.dragChip) this.dragChip.control.isVisible = false;
		this.options.onDragging(false);
		if (drag.draft !== drag.original)
			this.options.getProps().onStructureChange(drag.draft);
		this.options.onDraft(null);
		return true;
	}

	cancel() {
		if (!this.drag && !this.gizmoDraft) return;
		this.drag = null;
		if (this.dragChip) this.dragChip.control.isVisible = false;
		this.gizmoDraft = null;
		if (this.elementNode && this.element) {
			this.elementNode.position.set(
				this.element.position.x,
				this.element.position.y,
				this.element.position.z,
			);
			this.elementNode.scaling.setAll(1);
			this.elementNode.rotationQuaternion = elementRotation(
				this.element.rotationDeg,
			);
		}
		this.gizmo.releaseDrag();
		this.options.onDragging(false);
		this.options.onDraft(null);
	}

	tick(presenting: boolean) {
		this.presenting = presenting;
		if (this.dragChip)
			this.dragChip.control.isVisible = Boolean(this.drag) && !presenting;
		const activeCamera = this.options.scene.activeCamera;
		if (!activeCamera) return;
		const engine = this.options.scene.getEngine();
		const heightPx =
			engine.getRenderHeight() * engine.getHardwareScalingLevel();
		for (const view of this.views) {
			this.worldPosition.copyFrom(view.root.getAbsolutePosition());
			view.root.parent?.getWorldMatrix().decompose(this.worldScale);
			const metresPerPx = presenting
				? XR_HANDLE_METRES_PER_PX
				: (Vector3.Distance(activeCamera.globalPosition, this.worldPosition) *
						Math.tan(activeCamera.fov * HALF_RATIO) *
						2) /
					Math.max(1, heightPx);
			const hovered = view.mesh === this.hoveredMesh;
			const target = this.targets.get(view.mesh);
			const active = Boolean(
				this.drag &&
					target?.index === this.drag.target.index &&
					target.insert === this.drag.target.insert,
			);
			view.root.scaling.setAll(
				(metresPerPx / Math.max(Number.EPSILON, Math.abs(this.worldScale.y))) *
					(hovered || active ? HANDLE_HOVER_SIZE_PX / HANDLE_SIZE_PX : 1),
			);
			view.caption.isVisible = !presenting && (hovered || active);
		}
	}

	private clearHandles() {
		this.dragChip?.control.dispose();
		this.dragChip = null;
		for (const view of this.views) {
			view.caption.dispose();
			view.root.dispose();
		}
		this.views.length = 0;
		this.targets.clear();
		this.hoveredMesh = null;
		for (const material of this.materials) material.dispose();
		this.materials.length = 0;
	}

	dispose() {
		this.cancel();
		this.clearHandles();
		this.handleRoot.dispose();
		this.gizmo.dispose();
	}
}
