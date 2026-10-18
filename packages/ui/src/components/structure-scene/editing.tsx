import {
	BYPASS_PARAMETERS,
	PRIMITIVE_SIZE_RANGE_M,
} from "@hack-the-andes-project/business/structures/catalog";
import { MAX_BYPASS_POINTS } from "@hack-the-andes-project/business/structures/constants";
import {
	formatStructureLength,
	structureGradePercent,
	structureLengthM,
} from "@hack-the-andes-project/business/structures/geometry";
import type { Terrain } from "@hack-the-andes-project/terrain/types";
import { Billboard, Html, Text, TransformControls } from "@react-three/drei";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
	type ComponentRef,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Color,
	Group,
	LineBasicMaterial,
	MathUtils,
	Mesh,
	MeshBasicMaterial,
	Line as ThreeLine,
	Vector3,
} from "three";
import type {
	SceneStructure,
	StructureElement,
	StructurePoint,
	StructureSceneLabels,
	TransformMode,
} from "../../lib/structure-scene";
import { useIsPresenting } from "../structure-xr";
import {
	CHIP_MAXIMUM_FRACTION_DIGITS_COUNT,
	FULL_TURN_RAD,
	HANDLE_CHIP_FONT_SIZE_PX,
	HANDLE_CHIP_OFFSET_PX,
	HANDLE_CHIP_WIDTH_PX,
	HANDLE_DELETE_RADIUS_PX,
	HANDLE_HIT_SIZE_PX,
	HANDLE_HOVER_LEAVE_DELAY_MS,
	HANDLE_HOVER_SIZE_PX,
	HANDLE_LIFT_M,
	HANDLE_RENDER_ORDER,
	HANDLE_SIZE_PX,
	HANDLE_STEM_WIDTH_PX,
	MATERIAL_TOKEN_NAMES,
	MIDPOINT_HANDLE_SIZE_PX,
	ROTATION_SNAP_DEG,
	SCALE_SNAP_M,
	SELECTION_LINE_WIDTH_PX,
	SPHERE_SEGMENTS_COUNT,
	TRANSLATION_SNAP_M,
	XR_HANDLE_METRES_PER_PX,
} from "./constants";
import { DecorativeLine, ignoreRaycast } from "./decorations";
import {
	clampStructurePoint,
	groundFromPointer,
	snapHandlePoint,
} from "./interaction";
import { PrimitiveModel, type ScenePalette } from "./structure-model";

interface HandlePoint {
	point: StructurePoint;
	index: number;
	insert: boolean;
}
interface HandleDrag {
	original: SceneStructure;
	structure: SceneStructure;
	pointIndex: number;
	pointerId: number;
	insert: boolean;
}
interface HandleDiscProps {
	sizePx: number;
	fill: string;
	stroke: string;
	onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
	onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
	onPointerUp: (event: ThreeEvent<PointerEvent>) => void;
	onHover: (hovered: boolean) => void;
	onLostPointerCapture: () => void;
}
function HandleDisc({
	sizePx,
	fill,
	stroke,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	onHover,
	onLostPointerCapture,
}: HandleDiscProps) {
	const disc = useRef<Group>(null);
	const presenting = useIsPresenting();
	const viewport = useThree((state) => state.viewport);
	const size = useThree((state) => state.size);
	const worldPosition = useRef(new Vector3()).current;
	const parentScale = useRef(new Vector3(1, 1, 1)).current;
	useFrame(({ camera }) => {
		if (!disc.current) return;
		disc.current.getWorldPosition(worldPosition);
		disc.current.parent?.getWorldScale(parentScale);
		disc.current.scale.setScalar(
			(presenting
				? XR_HANDLE_METRES_PER_PX
				: viewport.getCurrentViewport(camera, worldPosition).height /
					size.height) / Math.max(Number.EPSILON, Math.abs(parentScale.y)),
		);
	});
	return (
		<Billboard>
			<group ref={disc}>
				<mesh
					renderOrder={HANDLE_RENDER_ORDER}
					userData={{ structureHandle: true }}
					onClick={(event: ThreeEvent<MouseEvent>) => event.stopPropagation()}
					onPointerDown={onPointerDown}
					onPointerMove={onPointerMove}
					onPointerUp={onPointerUp}
					onPointerOver={(event) => {
						event.stopPropagation();
						onHover(true);
					}}
					onPointerOut={() => onHover(false)}
					onLostPointerCapture={onLostPointerCapture}
				>
					<circleGeometry
						args={[HANDLE_HIT_SIZE_PX / 2, SPHERE_SEGMENTS_COUNT]}
					/>
					<meshBasicMaterial
						transparent
						opacity={0}
						depthTest={false}
						depthWrite={false}
					/>
				</mesh>
				<mesh
					renderOrder={HANDLE_RENDER_ORDER}
					raycast={ignoreRaycast}
					pointerEvents="none"
				>
					<circleGeometry args={[sizePx / 2, SPHERE_SEGMENTS_COUNT]} />
					<meshBasicMaterial
						color={fill}
						depthTest={false}
						depthWrite={false}
					/>
				</mesh>
				<mesh
					renderOrder={HANDLE_RENDER_ORDER}
					raycast={ignoreRaycast}
					pointerEvents="none"
				>
					<ringGeometry
						args={[
							sizePx / 2 - SELECTION_LINE_WIDTH_PX,
							sizePx / 2,
							SPHERE_SEGMENTS_COUNT,
						]}
					/>
					<meshBasicMaterial
						color={stroke}
						depthTest={false}
						depthWrite={false}
					/>
				</mesh>
			</group>
		</Billboard>
	);
}

interface StructureHandlesProps {
	structure: SceneStructure;
	terrain: Terrain;
	palette: ScenePalette;
	locale: string;
	labels: StructureSceneLabels;
	onDraft: (structure: SceneStructure | null) => void;
	onChange: (structure: SceneStructure) => void;
	onDragging: (dragging: boolean) => void;
}
export function StructureHandles({
	structure,
	terrain,
	palette,
	locale,
	labels,
	onDraft,
	onChange,
	onDragging,
}: StructureHandlesProps) {
	const drag = useRef<HandleDrag | null>(null);
	const presenting = useIsPresenting();
	const hoverLeaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			document.body.style.cursor = "";
			if (hoverLeaveTimeout.current) clearTimeout(hoverLeaveTimeout.current);
			onDraft(null);
			onDragging(false);
		},
		[onDraft, onDragging],
	);
	const [hoveredHandle, setHoveredHandle] = useState<string | null>(null);
	const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
	const template = structure.template;
	const controlPoints: HandlePoint[] =
		template.kind === "bypass"
			? template.points.map((point, index) => ({ point, index, insert: false }))
			: template.kind === "bridge" || template.kind === "tunnel"
				? [
						{ point: template.start, index: 0, insert: false },
						{ point: template.end, index: 1, insert: false },
					]
				: [];
	if (
		template.kind === "bypass" &&
		template.points.length < MAX_BYPASS_POINTS
	) {
		template.points.forEach((point, index) => {
			const next = template.points[index + 1];
			if (next)
				controlPoints.push({
					index: index + 1,
					insert: true,
					point: {
						x: (point.x + next.x) / 2,
						y: (point.y + next.y) / 2,
						z: (point.z + next.z) / 2,
					},
				});
		});
	}
	const anchor = terrain.toLocal(structure.anchor);
	const formatter = useMemo(
		() =>
			new Intl.NumberFormat(locale, {
				maximumFractionDigits: CHIP_MAXIMUM_FRACTION_DIGITS_COUNT,
			}),
		[locale],
	);
	const elevationDifferenceM =
		template.kind === "bridge" || template.kind === "tunnel"
			? template.end.y - template.start.y
			: 0;
	const lengthM = structureLengthM(template);
	const lengthLabel = useMemo(
		() => formatStructureLength(lengthM, locale),
		[lengthM, locale],
	);
	const measurements =
		template.kind === "bridge"
			? `${labels.span} ${lengthLabel} · ${labels.heightDifference} ${formatter.format(Math.abs(elevationDifferenceM))} m`
			: template.kind === "tunnel"
				? `${labels.length} ${lengthLabel} · ${labels.slope} ${formatter.format(structureGradePercent(template))} %`
				: `${labels.length} ${lengthLabel}`;
	const moveHandle = (event: ThreeEvent<PointerEvent>) => {
		const currentDrag = drag.current;
		if (!currentDrag) return;
		event.stopPropagation();
		const hit = groundFromPointer(terrain, event);
		if (!hit) return;
		const snappedPoint = snapHandlePoint(
			terrain,
			{ ...anchor, y: structure.anchor.elevationM },
			hit,
		);
		if (!snappedPoint) return;
		let currentTemplate = currentDrag.structure.template;
		if (currentDrag.insert && currentTemplate.kind === "bypass") {
			const points = [...currentTemplate.points];
			points.splice(currentDrag.pointIndex, 0, snappedPoint);
			currentTemplate = { ...currentTemplate, points };
			currentDrag.insert = false;
			setActivePointIndex(currentDrag.pointIndex);
		}
		if (currentTemplate.kind === "bypass")
			currentDrag.structure = {
				...currentDrag.structure,
				template: {
					...currentTemplate,
					points: currentTemplate.points.map((point, index) =>
						index === currentDrag.pointIndex ? snappedPoint : point,
					),
				},
			};
		else if (
			currentTemplate.kind === "bridge" ||
			currentTemplate.kind === "tunnel"
		)
			currentDrag.structure = {
				...currentDrag.structure,
				template: {
					...currentTemplate,
					[currentDrag.pointIndex === 0 ? "start" : "end"]: snappedPoint,
				},
			};
		onDraft(currentDrag.structure);
	};
	return (
		<group position={[anchor.x, structure.anchor.elevationM, anchor.z]}>
			{controlPoints.map((handle) => {
				const handleKey = `${handle.insert ? "insert" : "point"}-${handle.index}`;
				const hovered = hoveredHandle === handleKey;
				const active = activePointIndex === handle.index && !handle.insert;
				const groundY =
					(terrain.heightAt({
						x: anchor.x + handle.point.x,
						z: anchor.z + handle.point.z,
					}) ?? structure.anchor.elevationM) - structure.anchor.elevationM;
				const name =
					template.kind === "bridge"
						? `${labels.abutment} ${handle.index === 0 ? "A" : "B"}`
						: template.kind === "tunnel"
							? `${labels.portal} ${handle.index === 0 ? "A" : "B"}`
							: `${labels.point} ${handle.index + 1}`;
				return (
					<group
						key={handleKey}
						position={[
							handle.point.x,
							handle.point.y + HANDLE_LIFT_M,
							handle.point.z,
						]}
					>
						<HandleStem
							heightM={groundY - handle.point.y - HANDLE_LIFT_M}
							color={palette.color("--ring")}
						/>
						<HandleDisc
							sizePx={
								handle.insert
									? MIDPOINT_HANDLE_SIZE_PX
									: hovered
										? HANDLE_HOVER_SIZE_PX
										: HANDLE_SIZE_PX
							}
							fill={
								active ? palette.color("--primary") : palette.color("--card")
							}
							stroke={palette.color("--ring")}
							onHover={(isHovered) => {
								if (hoverLeaveTimeout.current)
									clearTimeout(hoverLeaveTimeout.current);
								if (isHovered) setHoveredHandle(handleKey);
								else
									hoverLeaveTimeout.current = setTimeout(
										() => setHoveredHandle(null),
										HANDLE_HOVER_LEAVE_DELAY_MS,
									);
								document.body.style.cursor =
									activePointIndex !== null
										? "grabbing"
										: isHovered
											? "grab"
											: "";
							}}
							onPointerDown={(event) => {
								if (event.button !== 0) return;
								event.stopPropagation();
								drag.current = {
									structure,
									original: structure,
									pointIndex: handle.index,
									pointerId: event.pointerId,
									insert: handle.insert,
								};
								if (!handle.insert) setActivePointIndex(handle.index);
								if (
									event.target &&
									"setPointerCapture" in event.target &&
									typeof event.target.setPointerCapture === "function"
								)
									event.target.setPointerCapture(event.pointerId);
								document.body.style.cursor = "grabbing";
								onDragging(true);
								onDraft(structure);
							}}
							onPointerMove={moveHandle}
							onPointerUp={(event) => {
								const currentDrag = drag.current;
								if (!currentDrag || currentDrag.pointerId !== event.pointerId)
									return;
								event.stopPropagation();
								drag.current = null;
								if (
									event.target &&
									"releasePointerCapture" in event.target &&
									typeof event.target.releasePointerCapture === "function"
								)
									event.target.releasePointerCapture(event.pointerId);
								setActivePointIndex(null);
								document.body.style.cursor = "";
								onDragging(false);
								onDraft(null);
								if (currentDrag.structure !== currentDrag.original)
									onChange(currentDrag.structure);
							}}
							onLostPointerCapture={() => {
								if (drag.current) {
									drag.current = null;
									setActivePointIndex(null);
									document.body.style.cursor = "";
									onDraft(null);
									onDragging(false);
								}
							}}
						/>
						{presenting && (handle.insert || hovered || active) && (
							<XrHandleLabel
								palette={palette}
								text={
									handle.insert
										? "+"
										: `${name}${active ? ` · ${measurements}` : ""}`
								}
								onDelete={
									template.kind === "bypass" &&
									template.points.length > BYPASS_PARAMETERS.minPointCount &&
									!handle.insert &&
									!active
										? () => {
												if (structure.template.kind === "bypass")
													onChange({
														...structure,
														template: {
															...structure.template,
															points: structure.template.points.filter(
																(_, index) => index !== handle.index,
															),
														},
													});
											}
										: undefined
								}
							/>
						)}
						{!presenting && handle.insert && (
							<Html center style={{ pointerEvents: "none" }}>
								<span className="type-data text-card-foreground">+</span>
							</Html>
						)}
						{!presenting && (hovered || active) && !handle.insert && (
							<Html
								center
								style={{
									pointerEvents: "none",
									transform: `translateY(-${HANDLE_CHIP_OFFSET_PX}px)`,
								}}
							>
								<div className="type-data -translate-y-full whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-popover-foreground">
									{name}
									{active ? ` · ${measurements}` : ""}
								</div>
							</Html>
						)}
						{!presenting &&
							template.kind === "bypass" &&
							template.points.length > BYPASS_PARAMETERS.minPointCount &&
							!handle.insert &&
							hovered &&
							activePointIndex === null && (
								<Html center position={[0, 0, 0]}>
									<button
										type="button"
										aria-label={`${labels.point} ${handle.index + 1} ×`}
										className="ml-8 grid size-6 place-items-center rounded-full border bg-card text-card-foreground"
										onPointerEnter={() => {
											if (hoverLeaveTimeout.current)
												clearTimeout(hoverLeaveTimeout.current);
											setHoveredHandle(handleKey);
										}}
										onPointerLeave={() => setHoveredHandle(null)}
										onPointerDown={(event) => event.stopPropagation()}
										onClick={(event) => {
											event.stopPropagation();
											if (structure.template.kind === "bypass")
												onChange({
													...structure,
													template: {
														...structure.template,
														points: structure.template.points.filter(
															(_, pointIndex) => pointIndex !== handle.index,
														),
													},
												});
										}}
									>
										×
									</button>
								</Html>
							)}
					</group>
				);
			})}
		</group>
	);
}

interface ElementGizmoProps {
	structure: SceneStructure;
	element: StructureElement;
	terrain: Terrain;
	palette: ScenePalette;
	mode: TransformMode;
	onChange: (structure: SceneStructure) => void;
	onDragging: (dragging: boolean) => void;
}
export function ElementGizmo({
	structure,
	element,
	terrain,
	palette,
	mode,
	onChange,
	onDragging,
}: ElementGizmoProps) {
	const [elementGroup] = useState(() => new Group());
	const controlsRef = useRef<ComponentRef<typeof TransformControls>>(null);
	const anchor = terrain.toLocal(structure.anchor);
	const transformChanged = useRef(false);
	useEffect(() => {
		const controls = controlsRef.current;
		return () => {
			controls?.detach();
			controls?.dispose();
			onDragging(false);
		};
	}, [onDragging]);
	useLayoutEffect(() => {
		elementGroup.position.set(
			element.position.x,
			element.position.y,
			element.position.z,
		);
		elementGroup.rotation.set(
			MathUtils.degToRad(element.rotationDeg.x),
			MathUtils.degToRad(element.rotationDeg.y),
			MathUtils.degToRad(element.rotationDeg.z),
		);
		elementGroup.scale.set(1, 1, 1);
		elementGroup.updateMatrixWorld(true);
	}, [elementGroup, element]);
	useEffect(() => {
		controlsRef.current?.traverse((object) => {
			if (!(object instanceof Mesh || object instanceof ThreeLine)) return;
			const color = palette.color(
				object.name.includes("X")
					? "--chart-2"
					: object.name.includes("Y")
						? "--chart-3"
						: object.name.includes("Z")
							? "--chart-4"
							: "--ring",
			);
			for (const material of Array.isArray(object.material)
				? object.material
				: [object.material]) {
				if (
					!(
						material instanceof MeshBasicMaterial ||
						material instanceof LineBasicMaterial
					)
				)
					continue;
				material.color.set(color);
				if ("tempColor" in material && material.tempColor instanceof Color)
					material.tempColor.set(color);
			}
		});
	}, [palette]);
	return (
		<group position={[anchor.x, structure.anchor.elevationM, anchor.z]}>
			<TransformControls
				object={elementGroup}
				ref={controlsRef}
				mode={mode}
				showX={mode !== "rotate"}
				showZ={mode !== "rotate"}
				translationSnap={TRANSLATION_SNAP_M}
				rotationSnap={MathUtils.degToRad(ROTATION_SNAP_DEG)}
				onMouseDown={() => {
					transformChanged.current = false;
					onDragging(true);
				}}
				onObjectChange={() => {
					transformChanged.current = true;
					const group = elementGroup;
					const clamped = clampStructurePoint(group.position);
					group.position.set(clamped.x, clamped.y, clamped.z);
					if (mode === "scale") {
						group.scale.set(
							Math.max(
								PRIMITIVE_SIZE_RANGE_M.min,
								Math.round(
									(element.widthM * Math.abs(group.scale.x)) / SCALE_SNAP_M,
								) * SCALE_SNAP_M,
							) / element.widthM,
							Math.max(
								PRIMITIVE_SIZE_RANGE_M.min,
								Math.round(
									(element.heightM * Math.abs(group.scale.y)) / SCALE_SNAP_M,
								) * SCALE_SNAP_M,
							) / element.heightM,
							Math.max(
								PRIMITIVE_SIZE_RANGE_M.min,
								Math.round(
									(element.depthM * Math.abs(group.scale.z)) / SCALE_SNAP_M,
								) * SCALE_SNAP_M,
							) / element.depthM,
						);
					}
				}}
				onMouseUp={() => {
					onDragging(false);
					const group = elementGroup;
					if (!transformChanged.current) return;
					transformChanged.current = false;
					const updatedElement = {
						...element,
						position: {
							x: group.position.x,
							y: group.position.y,
							z: group.position.z,
						},
						rotationDeg: {
							x: MathUtils.radToDeg(
								MathUtils.euclideanModulo(
									group.rotation.x + Math.PI,
									FULL_TURN_RAD,
								) - Math.PI,
							),
							y: MathUtils.radToDeg(
								MathUtils.euclideanModulo(
									group.rotation.y + Math.PI,
									FULL_TURN_RAD,
								) - Math.PI,
							),
							z: MathUtils.radToDeg(
								MathUtils.euclideanModulo(
									group.rotation.z + Math.PI,
									FULL_TURN_RAD,
								) - Math.PI,
							),
						},
						widthM: Math.min(
							PRIMITIVE_SIZE_RANGE_M.max,
							Math.max(
								PRIMITIVE_SIZE_RANGE_M.min,
								element.widthM * Math.abs(group.scale.x),
							),
						),
						heightM: Math.min(
							PRIMITIVE_SIZE_RANGE_M.max,
							Math.max(
								PRIMITIVE_SIZE_RANGE_M.min,
								element.heightM * Math.abs(group.scale.y),
							),
						),
						depthM: Math.min(
							PRIMITIVE_SIZE_RANGE_M.max,
							Math.max(
								PRIMITIVE_SIZE_RANGE_M.min,
								element.depthM * Math.abs(group.scale.z),
							),
						),
					};
					onChange({
						...structure,
						elements: structure.elements.map((candidate) =>
							candidate.id === element.id ? updatedElement : candidate,
						),
					});
				}}
			>
				<primitive
					object={elementGroup}
					onClick={(event: ThreeEvent<MouseEvent>) => event.stopPropagation()}
				>
					<PrimitiveModel
						element={element}
						color={palette.color(MATERIAL_TOKEN_NAMES[element.material])}
						highlight={palette.color("--ring")}
					/>
				</primitive>
			</TransformControls>
		</group>
	);
}

function HandleStem({ heightM, color }: { heightM: number; color: string }) {
	const points = useMemo<[number, number, number][]>(
		() => [
			[0, heightM, 0],
			[0, 0, 0],
		],
		[heightM],
	);
	return (
		<DecorativeLine
			points={points}
			color={color}
			lineWidth={HANDLE_STEM_WIDTH_PX}
			transparent
			renderOrder={HANDLE_RENDER_ORDER}
			depthTest={false}
		/>
	);
}

interface XrHandleLabelProps {
	palette: ScenePalette;
	text: string;
	onDelete?: () => void;
}
function XrHandleLabel({ palette, text, onDelete }: XrHandleLabelProps) {
	const group = useRef<Group>(null);
	const parentScale = useRef(new Vector3());
	useFrame(() => {
		if (!group.current) return;
		group.current.parent?.getWorldScale(parentScale.current);
		group.current.scale.setScalar(
			XR_HANDLE_METRES_PER_PX / Math.max(Number.EPSILON, parentScale.current.y),
		);
	});
	return (
		<Billboard>
			<group ref={group}>
				<Text
					raycast={ignoreRaycast}
					pointerEvents="none"
					position={[0, HANDLE_CHIP_OFFSET_PX, 0]}
					anchorY="bottom"
					fontSize={HANDLE_CHIP_FONT_SIZE_PX}
					maxWidth={HANDLE_CHIP_WIDTH_PX}
					color={palette.color("--foreground")}
					outlineColor={palette.color("--card")}
					outlineWidth={SELECTION_LINE_WIDTH_PX}
					material-depthTest={false}
					renderOrder={HANDLE_RENDER_ORDER}
				>
					{text}
				</Text>
				{onDelete && (
					<group
						position={[HANDLE_HIT_SIZE_PX, 0, 0]}
						onClick={(event) => {
							event.stopPropagation();
							onDelete();
						}}
						onPointerDown={(event) => event.stopPropagation()}
					>
						<mesh userData={{ structureHandle: true }}>
							<circleGeometry
								args={[HANDLE_DELETE_RADIUS_PX, SPHERE_SEGMENTS_COUNT]}
							/>
							<meshBasicMaterial
								color={palette.color("--card")}
								depthTest={false}
							/>
						</mesh>
						<Text
							raycast={ignoreRaycast}
							pointerEvents="none"
							fontSize={HANDLE_CHIP_FONT_SIZE_PX}
							color={palette.color("--foreground")}
							material-depthTest={false}
							renderOrder={HANDLE_RENDER_ORDER}
						>
							×
						</Text>
					</group>
				)}
			</group>
		</Billboard>
	);
}

interface ElementGrab {
	pointerId: number;
	offset: Vector3;
	original: StructureElement;
	draft: StructureElement;
}
export function XrElementGrab({
	structure,
	element,
	terrain,
	palette,
	onChange,
	onDragging,
}: ElementGizmoProps) {
	const anchor = terrain.toLocal(structure.anchor);
	const [draft, setDraft] = useState(element);
	const drag = useRef<ElementGrab | null>(null);
	useEffect(() => {
		setDraft(element);
	}, [element]);
	useEffect(() => () => onDragging(false), [onDragging]);
	return (
		<group position={[anchor.x, structure.anchor.elevationM, anchor.z]}>
			<group
				position={[draft.position.x, draft.position.y, draft.position.z]}
				rotation={[
					MathUtils.degToRad(draft.rotationDeg.x),
					MathUtils.degToRad(draft.rotationDeg.y),
					MathUtils.degToRad(draft.rotationDeg.z),
				]}
				onClick={(event) => event.stopPropagation()}
				onPointerDown={(event) => {
					event.stopPropagation();
					const local = terrain.group
						.worldToLocal(event.point.clone())
						.sub(new Vector3(anchor.x, structure.anchor.elevationM, anchor.z));
					drag.current = {
						pointerId: event.pointerId,
						offset: local.sub(
							new Vector3(draft.position.x, draft.position.y, draft.position.z),
						),
						original: element,
						draft,
					};
					if (
						event.target &&
						"setPointerCapture" in event.target &&
						typeof event.target.setPointerCapture === "function"
					)
						event.target.setPointerCapture(event.pointerId);
					onDragging(true);
				}}
				onPointerMove={(event) => {
					const current = drag.current;
					if (!current || current.pointerId !== event.pointerId) return;
					event.stopPropagation();
					const point = terrain.group
						.worldToLocal(event.point.clone())
						.sub(new Vector3(anchor.x, structure.anchor.elevationM, anchor.z))
						.sub(current.offset);
					const position = clampStructurePoint({
						x: Math.round(point.x / TRANSLATION_SNAP_M) * TRANSLATION_SNAP_M,
						y: Math.round(point.y / TRANSLATION_SNAP_M) * TRANSLATION_SNAP_M,
						z: Math.round(point.z / TRANSLATION_SNAP_M) * TRANSLATION_SNAP_M,
					});
					if (
						position.x === current.draft.position.x &&
						position.y === current.draft.position.y &&
						position.z === current.draft.position.z
					)
						return;
					current.draft = { ...element, position };
					setDraft(current.draft);
				}}
				onPointerUp={(event) => {
					const current = drag.current;
					if (!current || current.pointerId !== event.pointerId) return;
					event.stopPropagation();
					drag.current = null;
					if (
						event.target &&
						"releasePointerCapture" in event.target &&
						typeof event.target.releasePointerCapture === "function"
					)
						event.target.releasePointerCapture(event.pointerId);
					onDragging(false);
					if (current.draft !== current.original)
						onChange({
							...structure,
							elements: structure.elements.map((candidate) =>
								candidate.id === element.id ? current.draft : candidate,
							),
						});
				}}
				onLostPointerCapture={() => {
					if (drag.current) {
						drag.current = null;
						setDraft(element);
						onDragging(false);
					}
				}}
			>
				<PrimitiveModel
					element={draft}
					color={palette.color(MATERIAL_TOKEN_NAMES[draft.material])}
					highlight={palette.color("--ring")}
				/>
			</group>
		</group>
	);
}
