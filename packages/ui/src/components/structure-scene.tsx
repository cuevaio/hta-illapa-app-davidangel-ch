"use client";

import { MAX_STRUCTURE_ELEMENTS } from "@hack-the-andes-project/business/structures/constants";
import { PE22_TERRAIN_ORIGIN } from "@hack-the-andes-project/business/structures/landmarks";
import { createTerrain, type Terrain } from "@hack-the-andes-project/terrain";
import { Html } from "@react-three/drei";
import { Canvas, events, type ThreeEvent, useThree } from "@react-three/fiber";
import {
	Component,
	type ErrorInfo,
	type ReactNode,
	useCallback,
	useEffect,
	useEffectEvent,
	useMemo,
	useRef,
	useState,
} from "react";
import { Color, type Group, Raycaster } from "three";
import { useTokenColors } from "../hooks/use-token-colors";
import { STRUCTURE_COLOR_TOKENS } from "../lib/structure-colors";
import type {
	SceneStructure,
	StructureSceneProps,
} from "../lib/structure-scene";
import { cn } from "../lib/utils";
import { SceneCamera } from "./structure-scene/camera";
import {
	CAMERA_FAR_M,
	CAMERA_FIELD_OF_VIEW_DEG,
	CAMERA_NEAR_M,
	DPR_MAX_RATIO,
	DRAG_CLICK_SUPPRESSION_MS,
	GHOST_PREVIEW_OPACITY_RATIO,
	HOVER_OUTLINE_OPACITY_RATIO,
	MAX_VISIBLE_INCIDENT_MARKERS_COUNT,
	SKY_INTENSITY_RATIO,
	SUN_INTENSITY_RATIO,
	SUN_POSITION_M,
	TERRAIN_HEIGHT_CHANGE_EPSILON_M,
	TERRAIN_LOAD_TIMEOUT_MS,
	TERRAIN_REFRESH_INTERVAL_MS,
	TERRAIN_REVISION_SAMPLE_SPACING_M,
	TUNNEL_TERRAIN_OPACITY_RATIO,
} from "./structure-scene/constants";
import {
	ElementGizmo,
	StructureHandles,
	XrElementGrab,
} from "./structure-scene/editing";
import { ExposureRing } from "./structure-scene/exposure-ring";
import { IncidentMarker } from "./structure-scene/incident-marker";
import {
	clampStructurePoint,
	directPointer,
	groundFromPointer,
	PointerGestures,
} from "./structure-scene/interaction";
import { Landmark } from "./structure-scene/landmark";
import { pickPlacement, TerrainPicker } from "./structure-scene/picking";
import { createPlacement, relativeToAnchor } from "./structure-scene/placement";
import { useScenePointer } from "./structure-scene/pointer";
import { StructureLabel } from "./structure-scene/structure-label";
import {
	type ScenePalette,
	StructureModel,
} from "./structure-scene/structure-model";
import { TerrainGrid } from "./structure-scene/terrain-grid";
import { TerrainPointerSurface } from "./structure-scene/terrain-pointer-surface";
import { StructureXrSession, useIsPresenting } from "./structure-xr";

interface SceneBoundaryProps {
	children: ReactNode;
	onError: () => void;
}
interface SceneBoundaryState {
	failed: boolean;
}
class SceneBoundary extends Component<SceneBoundaryProps, SceneBoundaryState> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch(_error: Error, _info: ErrorInfo) {
		this.props.onError();
	}
	render() {
		return this.state.failed ? null : this.props.children;
	}
}
interface UnavailableSceneProps {
	label: string;
	onError: () => void;
}
function UnavailableScene({ label, onError }: UnavailableSceneProps) {
	const reportError = useEffectEvent(onError);
	useEffect(() => {
		reportError();
	}, []);
	return (
		<div role="alert" className="p-4 text-foreground">
			{label}
		</div>
	);
}
interface SceneContentProps extends StructureSceneProps {
	palette: ScenePalette;
}
interface SceneWorldProps extends SceneContentProps {
	terrain: Terrain;
	terrainRevision: number;
}

function SceneContent(props: SceneContentProps) {
	const renderer = useThree((state) => state.gl);
	const [terrain, setTerrain] = useState<Terrain | null>(null);
	const [terrainRevision, setTerrainRevision] = useState(0);
	const reportStatus = useEffectEvent(props.onTerrainStatusChange);
	const heightSignature = useRef<(number | null)[]>([]);
	const refreshHeights = useEffectEvent((resource: Terrain) => {
		const points = props.structures.flatMap((structure) => {
			const anchor = resource.toLocal(structure.anchor);
			const template = structure.template;
			const offsets =
				template.kind === "bypass"
					? template.points
					: template.kind === "entity"
						? []
						: [template.start, template.end];
			const samples =
				template.kind === "bypass"
					? template.points.flatMap((point, index) => {
							const next = template.points[index + 1];
							if (!next) return [];
							const count = Math.ceil(
								Math.hypot(next.x - point.x, next.z - point.z) /
									TERRAIN_REVISION_SAMPLE_SPACING_M,
							);
							return Array.from({ length: count }, (_, sampleIndex) => ({
								x: point.x + ((next.x - point.x) * sampleIndex) / count,
								z: point.z + ((next.z - point.z) * sampleIndex) / count,
							}));
						})
					: [];
			return [
				anchor,
				...[...offsets, ...samples].map((point) => ({
					x: anchor.x + point.x,
					z: anchor.z + point.z,
				})),
			];
		});
		const next = [{ x: 0, z: 0 }, ...points].map((point) =>
			resource.heightAt(point),
		);
		if (
			next.length !== heightSignature.current.length ||
			next.some((height, index) => {
				const previous = heightSignature.current[index];
				return height === null || previous == null
					? height !== previous
					: Math.abs(height - previous) > TERRAIN_HEIGHT_CHANGE_EPSILON_M;
			})
		) {
			heightSignature.current = next;
			setTerrainRevision((revision) => revision + 1);
		}
	});
	useEffect(() => {
		let active = true;
		let hasReportedReady = false;
		let lastRefreshMs = 0;
		let terrainResource: Terrain | undefined;
		let refreshTimeout: ReturnType<typeof setTimeout> | undefined;
		const loadingTimeout = window.setTimeout(() => {
			if (active && !hasReportedReady) reportStatus("error");
		}, TERRAIN_LOAD_TIMEOUT_MS);
		reportStatus("loading");
		try {
			const nextTerrain = createTerrain({
				renderer,
				origin: PE22_TERRAIN_ORIGIN,
				onTilesLoaded: () => {
					if (!active) return;
					if (
						!hasReportedReady &&
						terrainResource?.heightAt({ x: 0, z: 0 }) != null
					) {
						hasReportedReady = true;
						window.clearTimeout(loadingTimeout);
						reportStatus("ready");
					}
					if (
						performance.now() - lastRefreshMs >=
						TERRAIN_REFRESH_INTERVAL_MS
					) {
						lastRefreshMs = performance.now();
						if (terrainResource) refreshHeights(terrainResource);
					} else if (refreshTimeout === undefined) {
						refreshTimeout = setTimeout(
							() => {
								refreshTimeout = undefined;
								if (!active) return;
								lastRefreshMs = performance.now();
								if (terrainResource) refreshHeights(terrainResource);
							},
							TERRAIN_REFRESH_INTERVAL_MS - (performance.now() - lastRefreshMs),
						);
					}
				},
			});
			terrainResource = nextTerrain;
			setTerrain(nextTerrain);
			return () => {
				active = false;
				window.clearTimeout(loadingTimeout);
				if (refreshTimeout !== undefined) clearTimeout(refreshTimeout);
				setTerrain(null);
				nextTerrain.dispose();
			};
		} catch {
			setTerrain(null);
			window.clearTimeout(loadingTimeout);
			reportStatus("error");
			return () => {
				active = false;
			};
		}
	}, [renderer]);
	useEffect(() => {
		const canvas = renderer.domElement;
		canvas.setAttribute("aria-label", props.labels.canvas);
		canvas.setAttribute("role", "img");
		canvas.tabIndex = 0;
		const onContextLost = () => reportStatus("error");
		canvas.addEventListener("webglcontextlost", onContextLost);
		return () => canvas.removeEventListener("webglcontextlost", onContextLost);
	}, [renderer, props.labels.canvas]);
	const selectedStructure = props.structures.find(
		(structure) => structure.id === props.selectedStructureId,
	);
	return terrain ? (
		<>
			<color attach="background" args={[props.palette.color("--background")]} />
			<StructureXrSession
				store={props.xrStore}
				terrain={terrain}
				focus={
					selectedStructure ? terrain.toLocal(selectedStructure.anchor) : null
				}
				labels={{
					placeTable: props.labels.placeTable,
					undo: props.labels.undo,
					exit: props.labels.exitXr,
				}}
				onUndo={props.onUndo}
			>
				<SceneWorld
					{...props}
					terrain={terrain}
					terrainRevision={terrainRevision}
				/>
			</StructureXrSession>
		</>
	) : null;
}

function SceneWorld(props: SceneWorldProps) {
	const { terrain, terrainRevision, palette } = props;
	const [draft, setDraft] = useState<SceneStructure | null>(null);
	const [dragging, setDragging] = useState(false);
	const suppressClickUntilMs = useRef(0);
	const setInteractionDragging = useCallback((isDragging: boolean) => {
		setDragging(isDragging);
		suppressClickUntilMs.current = isDragging
			? Number.POSITIVE_INFINITY
			: performance.now() + DRAG_CLICK_SUPPRESSION_MS;
	}, []);
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const structureRoot = useRef<Group>(null);
	const clickRaycaster = useRef(new Raycaster());
	const presenting = useIsPresenting();
	const camera = useThree((state) => state.camera);
	const picker = useMemo(() => new TerrainPicker(terrain), [terrain]);
	const gestures = useRef(new PointerGestures());
	const selectedStructure = props.structures.find(
		(structure) => structure.id === props.selectedStructureId,
	);
	const canPlace = !(
		props.placementTool &&
		"primitive" in props.placementTool &&
		props.primitiveTarget === "selection" &&
		selectedStructure &&
		selectedStructure.elements.length >= MAX_STRUCTURE_ELEMENTS
	);
	const { cursor, previewCursor, screenPosition, schedulePointer } =
		useScenePointer({
			terrain,
			picker,
			structureRoot,
			placementTool: props.placementTool,
			dragging,
			presenting,
			canPlace,
			onCursorChange: props.onCursorChange,
		});
	const selectedElement = selectedStructure?.elements.find(
		(element) => element.id === props.selectedElementId,
	);
	const exposureStructure = props.structures.find(
		(structure) => structure.id === props.exposureRing?.structureId,
	);
	useEffect(() => {
		terrain.setOpacity(
			selectedStructure?.template.kind === "tunnel"
				? TUNNEL_TERRAIN_OPACITY_RATIO
				: 1,
		);
		return () => terrain.setOpacity(1);
	}, [terrain, selectedStructure?.template.kind]);
	const preview = useMemo(
		() =>
			props.placementTool && previewCursor
				? createPlacement(
						terrain,
						previewCursor,
						props.placementTool,
						"placement-preview",
					)
				: null,
		[terrain, previewCursor, props.placementTool],
	);
	const ghostPalette = useMemo<ScenePalette>(
		() => ({ color: () => palette.color("--primary") }),
		[palette],
	);
	const selectedAnchor = selectedStructure
		? {
				...terrain.toLocal(selectedStructure.anchor),
				y: selectedStructure.anchor.elevationM,
			}
		: null;
	const gridCenter = props.placementTool ? cursor : selectedAnchor;
	const foreground = new Color(palette.color("--foreground"));
	const card = new Color(palette.color("--card"));
	const lightColor = palette.color(
		foreground.r + foreground.g + foreground.b > card.r + card.g + card.b
			? "--foreground"
			: "--card",
	);
	const gridColor = lightColor;
	const placeOrDeselect = (event: ThreeEvent<PointerEvent>) => {
		event.stopPropagation();
		if (
			dragging ||
			performance.now() < suppressClickUntilMs.current ||
			!gestures.current.isClick(event)
		)
			return;
		if (!canPlace) return;
		clickRaycaster.current.ray.copy(event.ray);
		const hit = pickPlacement(
			terrain,
			clickRaycaster.current,
			structureRoot.current,
			props.placementTool,
			directPointer(event.pointerType)
				? groundFromPointer(terrain, event)
				: picker.pick(event.ray),
			camera,
		);
		if (!hit) return;
		if (props.placementTool) {
			const placed = createPlacement(terrain, hit, props.placementTool);
			if (
				"primitive" in props.placementTool &&
				selectedStructure &&
				props.primitiveTarget === "selection"
			) {
				const element = placed.elements[0];
				if (element)
					props.onStructureChange({
						...selectedStructure,
						elements: [
							...selectedStructure.elements,
							{
								...element,
								position: clampStructurePoint(
									relativeToAnchor(terrain, selectedStructure, hit),
								),
							},
						],
					});
			} else props.onCreateStructure(placed);
		} else {
			props.onSelectElement(null);
			props.onSelectStructure(null);
		}
	};
	const latestSelection = useRef({
		tool: props.placementTool,
		onSelectStructure: props.onSelectStructure,
		onSelectElement: props.onSelectElement,
		selectedId: props.selectedStructureId,
	});
	latestSelection.current = {
		tool: props.placementTool,
		onSelectStructure: props.onSelectStructure,
		onSelectElement: props.onSelectElement,
		selectedId: props.selectedStructureId,
	};
	const onModelElementClick = useCallback(
		(
			elementId: string,
			event: ThreeEvent<MouseEvent>,
			structureId?: string,
		) => {
			const selection = latestSelection.current;
			if (
				!structureId ||
				selection.tool ||
				performance.now() < suppressClickUntilMs.current ||
				!gestures.current.isClick(event)
			)
				return;
			event.stopPropagation();
			selection.onSelectStructure(structureId);
			selection.onSelectElement(
				selection.selectedId === structureId ? elementId : null,
			);
		},
		[],
	);
	const ElementEditor = presenting ? XrElementGrab : ElementGizmo;
	return (
		<>
			<hemisphereLight
				args={[lightColor, palette.color("--muted"), SKY_INTENSITY_RATIO]}
			/>
			<directionalLight
				color={lightColor}
				position={SUN_POSITION_M}
				intensity={SUN_INTENSITY_RATIO}
			/>
			<SceneCamera
				terrain={terrain}
				dragging={dragging}
				structures={props.structures}
				cameraRequest={props.cameraRequest}
				insets={props.insets}
			/>
			<primitive object={terrain.group} pointerEvents="none" />
			<group
				onPointerDown={(event) => gestures.current.down(event)}
				onClick={placeOrDeselect}
				onPointerMove={(event) => {
					if (!dragging) schedulePointer(event);
				}}
			>
				<TerrainPointerSurface terrain={terrain} picker={picker} />
				<group ref={structureRoot}>
					{props.structures.map((structure) => {
						const selected = structure.id === props.selectedStructureId;
						const hovered =
							hoveredId === structure.id ||
							props.hoveredStructureId === structure.id;
						return (
							<group
								key={structure.id}
								onPointerOver={(event) => {
									if (!props.placementTool) {
										event.stopPropagation();
										setHoveredId(structure.id);
									}
								}}
								onPointerOut={() => setHoveredId(null)}
								onClick={(event) => {
									if (
										props.placementTool ||
										performance.now() < suppressClickUntilMs.current ||
										!gestures.current.isClick(event)
									)
										return;
									event.stopPropagation();
									props.onSelectStructure(structure.id);
									props.onSelectElement(null);
								}}
							>
								<StructureModel
									structure={draft?.id === structure.id ? draft : structure}
									terrain={terrain}
									terrainRevision={terrainRevision}
									palette={palette}
									highlight={
										selected
											? palette.color("--ring")
											: hovered
												? palette.color("--foreground")
												: undefined
									}
									highlightOpacity={selected ? 1 : HOVER_OUTLINE_OPACITY_RATIO}
									selectedElementId={selected ? props.selectedElementId : null}
									hideElementId={
										selected && !props.placementTool
											? props.selectedElementId
											: null
									}
									structureId={structure.id}
									onElementClick={onModelElementClick}
								/>
								{!presenting && (
									<StructureLabel
										terrainRevision={terrainRevision}
										structure={draft?.id === structure.id ? draft : structure}
										terrain={terrain}
										palette={palette}
										selected={selected}
									/>
								)}
							</group>
						);
					})}
				</group>
			</group>
			{preview && (
				<group pointerEvents="none">
					<StructureModel
						structure={preview}
						terrain={terrain}
						palette={ghostPalette}
						opacity={GHOST_PREVIEW_OPACITY_RATIO}
						highlight={palette.color(
							cursor && canPlace ? "--ring" : "--destructive",
						)}
					/>
				</group>
			)}
			{!presenting &&
				props.placementTool &&
				(!cursor || !canPlace) &&
				screenPosition && (
					<Html fullscreen style={{ pointerEvents: "none" }}>
						<div
							className="type-data absolute whitespace-nowrap rounded-md border border-destructive bg-popover px-3 py-2 text-popover-foreground"
							style={{ left: screenPosition.x, top: screenPosition.y }}
						>
							{props.labels.outsideTerrain}
						</div>
					</Html>
				)}
			{!presenting && gridCenter && (
				<TerrainGrid
					terrain={terrain}
					center={gridCenter}
					terrainRevision={terrainRevision}
					color={gridColor}
				/>
			)}
			{selectedStructure && !props.placementTool && (
				<StructureHandles
					key={selectedStructure.id}
					structure={
						draft?.id === selectedStructure.id ? draft : selectedStructure
					}
					terrain={terrain}
					palette={palette}
					locale={props.locale}
					labels={props.labels}
					onDraft={setDraft}
					onChange={props.onStructureChange}
					onDragging={setInteractionDragging}
				/>
			)}
			{selectedStructure && selectedElement && !props.placementTool && (
				<ElementEditor
					key={selectedElement.id}
					structure={selectedStructure}
					element={selectedElement}
					terrain={terrain}
					palette={palette}
					mode={props.transformMode}
					onChange={props.onStructureChange}
					onDragging={setInteractionDragging}
				/>
			)}
			{exposureStructure && props.exposureRing && (
				<ExposureRing
					terrainRevision={terrainRevision}
					terrain={terrain}
					structure={exposureStructure}
					radiusM={props.exposureRing.radiusM}
					color={palette.color("--info")}
				/>
			)}
			{!presenting &&
				props.incidentMarkers
					.slice(0, MAX_VISIBLE_INCIDENT_MARKERS_COUNT)
					.map((marker) => (
						<IncidentMarker
							key={marker.id}
							marker={marker}
							terrain={terrain}
							palette={palette}
						/>
					))}
			{!presenting &&
				props.landmarks.map((landmark) => (
					<Landmark
						key={landmark.name}
						landmark={landmark}
						terrain={terrain}
						structures={props.structures}
					/>
				))}
		</>
	);
}

export function StructureScene(props: StructureSceneProps) {
	const tokenColors = useTokenColors(STRUCTURE_COLOR_TOKENS);
	const palette = useMemo<ScenePalette>(
		() => ({ color: (token) => tokenColors[token] ?? "" }),
		[tokenColors],
	);
	const [failed, setFailed] = useState(false);
	return (
		<div
			className={cn(
				"relative isolate h-full w-full overflow-hidden bg-background",
				props.className,
			)}
		>
			{tokenColors["--background"] && (
				<SceneBoundary
					onError={() => {
						setFailed(true);
						props.onTerrainStatusChange("error");
					}}
				>
					<Canvas
						frameloop="always"
						events={(state) => ({
							...events(state),
							filter: (intersections) =>
								intersections.sort(
									(first, second) =>
										Number(Boolean(second.object.userData.structureHandle)) -
										Number(Boolean(first.object.userData.structureHandle)),
								),
						})}
						dpr={[1, DPR_MAX_RATIO]}
						camera={{
							fov: CAMERA_FIELD_OF_VIEW_DEG,
							near: CAMERA_NEAR_M,
							far: CAMERA_FAR_M,
						}}
						fallback={
							<UnavailableScene
								label={props.labels.terrainError}
								onError={() => props.onTerrainStatusChange("error")}
							/>
						}
					>
						<SceneContent {...props} palette={palette} />
					</Canvas>
				</SceneBoundary>
			)}
			{failed && (
				<div
					role="alert"
					className="absolute inset-0 grid place-items-center bg-background text-foreground"
				>
					{props.labels.terrainError}
				</div>
			)}
		</div>
	);
}
