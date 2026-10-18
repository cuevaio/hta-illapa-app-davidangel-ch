import { METERS_PER_KM } from "@hack-the-andes-project/business/constants";
import {
	TILES_API_PATH,
	WEATHER_API_PATH,
} from "@hack-the-andes-project/business/simulators";
import { STRUCTURE_EXPOSURE_RADIUS_M } from "@hack-the-andes-project/business/structures/constants";
import {
	structureExposure,
	structureExposureBounds,
} from "@hack-the-andes-project/business/structures/exposure";
import {
	PE22_LANDMARKS,
	PE22_TERRAIN_ORIGIN,
} from "@hack-the-andes-project/business/structures/landmarks";
import {
	nextStructureName,
	structureElementName,
} from "@hack-the-andes-project/business/structures/naming";
import { Button } from "@hack-the-andes-project/ui/components/button";
import { SidebarTrigger } from "@hack-the-andes-project/ui/components/sidebar";
import {
	StructureEditorAttribution,
	StructureEditorBanner,
	StructureEditorCameraControls,
	StructureEditorHeader,
	StructureEditorNotice,
	StructureEditorPhoneNotice,
} from "@hack-the-andes-project/ui/components/structure-editor-chrome";
import {
	StructureEditorConfirmDialog,
	StructureEditorShortcutsDialog,
} from "@hack-the-andes-project/ui/components/structure-editor-dialogs";
import { StructureEditorExposure } from "@hack-the-andes-project/ui/components/structure-editor-exposure";
import { StructureEditorList } from "@hack-the-andes-project/ui/components/structure-editor-list";
import {
	StructureEditorPalette,
	type StructurePaletteItem,
} from "@hack-the-andes-project/ui/components/structure-editor-palette";
import { StructureEditorParameters } from "@hack-the-andes-project/ui/components/structure-editor-parameters";
import {
	STRUCTURES_MODE_ID,
	XrViewer,
} from "@hack-the-andes-project/ui/components/xr-viewer";
import { INCIDENT_SOURCE_LABELS } from "@hack-the-andes-project/ui/lib/incident-constants";
import type {
	PlacementTool,
	PrimitiveTarget,
	SceneCameraRequest,
	SceneCursor,
	SceneStructure,
	SceneXrRequest,
	TerrainStatus,
	TransformMode,
} from "@hack-the-andes-project/ui/lib/structure-scene";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MapIcon } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	DEFAULT_INCIDENT_LIMIT_ROWS,
	ENGINEERING_BOTTOM_STRIP_HEIGHT_PX,
	ENGINEERING_COMPACT_PANEL_WIDTH_PX,
	ENGINEERING_COORDINATE_DIGITS,
	ENGINEERING_COUNT_FRACTION_DIGITS,
	ENGINEERING_DESKTOP_BREAKPOINT_PX,
	ENGINEERING_DISTANCE_DIGITS,
	ENGINEERING_ELEVATION_FRACTION_DIGITS,
	ENGINEERING_LEFT_PANEL_WIDTH_PX,
	ENGINEERING_OVERLAY_GAP_PX,
	ENGINEERING_RIGHT_PANEL_WIDTH_PX,
	ENGINEERING_SLOPE_FRACTION_DIGITS,
	ENGINEERING_UNDO_TOAST_ID,
	ENGINEERING_WIDE_BREAKPOINT_PX,
	INCIDENT_REFETCH_INTERVAL_MS,
} from "@/constants";
import { ENV } from "@/env.public";
import { structureEditorFields } from "@/lib/structure-editor-fields";
import { structureEditorLabels } from "@/lib/structure-editor-labels";
import { STRUCTURE_PALETTE_TOOLS } from "@/lib/structure-editor-tools";
import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";
import { orpc } from "@/utils/orpc";
import { useStructureEditor } from "./structure-editor-provider";

const SERVER_URL = ENV.VITE_SERVER_URL.replace(/\/$/, "");

export function StructureEditor({ selectedId }: { selectedId: string | null }) {
	const { session, snapshot, query } = useStructureEditor();
	const navigate = useNavigate();
	const labels = structureEditorLabels();

	const locale = getLocale();
	const distanceFormatter = useMemo(
		() =>
			new Intl.NumberFormat(locale, {
				maximumFractionDigits: ENGINEERING_DISTANCE_DIGITS,
			}),
		[locale],
	);
	const timeFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
		[locale],
	);
	const elevationFormatter = useMemo(
		() =>
			new Intl.NumberFormat(locale, {
				maximumFractionDigits: ENGINEERING_ELEVATION_FRACTION_DIGITS,
			}),
		[locale],
	);
	const countFormatter = useMemo(
		() =>
			new Intl.NumberFormat(locale, {
				maximumFractionDigits: ENGINEERING_COUNT_FRACTION_DIGITS,
			}),
		[locale],
	);
	const slopeFormatter = useMemo(
		() =>
			new Intl.NumberFormat(locale, {
				maximumFractionDigits: ENGINEERING_SLOPE_FRACTION_DIGITS,
			}),
		[locale],
	);
	const [placementTool, setPlacementTool] = useState<PlacementTool | null>(
		null,
	);
	const [primitiveTarget, setPrimitiveTarget] =
		useState<PrimitiveTarget>("selection");
	const [selectedElementId, setSelectedElementId] = useState<string | null>(
		null,
	);
	const [hoveredStructureId, setHoveredStructureId] = useState<string | null>(
		null,
	);
	const [transformMode, setTransformMode] =
		useState<TransformMode>("translate");
	const [cameraRequest, setCameraRequest] = useState<SceneCameraRequest | null>(
		null,
	);
	const cameraRequestId = useRef(0);
	const [xrRequest, setXrRequest] = useState<SceneXrRequest | null>(null);
	const xrRequestId = useRef(0);
	const [isArSupported, setIsArSupported] = useState(false);
	const [isXrPresenting, setIsXrPresenting] = useState(false);
	const [activePanelTab, setActivePanelTab] = useState("parameters");
	const [terrainStatus, setTerrainStatus] = useState<TerrainStatus>("loading");
	const [terrainWasReady, setTerrainWasReady] = useState(false);
	const [terrainAttempt, setTerrainAttempt] = useState(0);
	const [viewerScreen, setViewerScreen] = useState("overview");
	const [overviewRequest, setOverviewRequest] = useState(0);
	const [structuresRequest, setStructuresRequest] = useState(0);
	const [openStructures] = useState(() => Boolean(selectedId));
	const structuresActive = viewerScreen === STRUCTURES_MODE_ID;
	const [cursor, setCursor] = useState<SceneCursor | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const [announcement, setAnnouncement] = useState("");
	const [isDesktopViewport, setDesktopViewport] = useState(
		() =>
			matchMedia(`(min-width: ${ENGINEERING_DESKTOP_BREAKPOINT_PX}px)`).matches,
	);
	const [isWideViewport, setWideViewport] = useState(
		() =>
			matchMedia(`(min-width: ${ENGINEERING_WIDE_BREAKPOINT_PX}px)`).matches,
	);
	const isOnline = snapshot.save.isOnline;
	const rejectedStructureId = snapshot.save.rejectedIds.values().next().value;
	const sceneContainer = useRef<HTMLDivElement>(null);
	const selectedStructure = snapshot.structures.find(
		(structure) => structure.id === selectedId,
	);
	const selectedElement = selectedStructure?.elements.find(
		(candidate) => candidate.id === selectedElementId,
	);

	const selectedAnchor = selectedStructure?.anchor ?? PE22_TERRAIN_ORIGIN;
	const { lat: anchorLatitude, lng: anchorLongitude } = selectedAnchor;
	const exposureBounds = useMemo(
		() =>
			structureExposureBounds({ lat: anchorLatitude, lng: anchorLongitude }),
		[anchorLatitude, anchorLongitude],
	);
	const incidentsQuery = useQuery({
		...orpc.incidents.list.queryOptions({
			input: {
				bbox: exposureBounds,
				limit: DEFAULT_INCIDENT_LIMIT_ROWS,
			},
		}),
		enabled: Boolean(selectedStructure),
		refetchInterval: INCIDENT_REFETCH_INTERVAL_MS,
		meta: { silentError: true },
	});
	const exposure = useMemo(
		() =>
			selectedStructure
				? structureExposure(selectedStructure.anchor, incidentsQuery.data ?? [])
				: [],
		[selectedStructure, incidentsQuery.data],
	);
	const activeToolId = placementTool
		? "kind" in placementTool
			? placementTool.kind
			: placementTool.primitive
		: null;
	const paletteItems: StructurePaletteItem[] = STRUCTURE_PALETTE_TOOLS.map(
		(definition) => ({
			...definition,
			label: labels[definition.id],
			armed: definition.id === activeToolId,
		}),
	);
	const activeTool = paletteItems.find((item) => item.armed);
	const primitiveArmed = Boolean(placementTool && "primitive" in placementTool);
	const paletteDisabledReason =
		!query.hasData || query.isLoadingError
			? labels.waitStructures
			: terrainStatus !== "ready"
				? labels.waitTerrain
				: null;

	const selectStructure = (id: string | null) => {
		setSelectedElementId(null);
		setActivePanelTab("parameters");
		setDeleteOpen(false);
		if (id) {
			void navigate({
				to: "/ingenieria/estructuras/$structureId",
				params: { structureId: id },
				replace: true,
			});
			const structure = snapshot.structures.find(
				(candidate) => candidate.id === id,
			);
			if (structure)
				setAnnouncement(m.engineering_selected({ name: structure.name }));
		} else void navigate({ to: "/ingenieria", replace: true });
	};
	const replay = (direction: "undo" | "redo") => {
		const step = session.replay(direction);
		if (!step) return;
		const message =
			direction === "undo"
				? m.engineering_undone({ action: step.action })
				: m.engineering_redone({ action: step.action });
		toast(message);
		setAnnouncement(message);
		const target = direction === "undo" ? step.before : step.after;
		if (!target && (step.after ?? step.before)?.id === selectedId)
			selectStructure(null);
		else if (target && !selectedId) selectStructure(target.id);
		setSelectedElementId(null);
	};
	const deleteElement = (elementId: string) => {
		if (!selectedStructure) return;
		const removed = selectedStructure.elements.find(
			(candidate) => candidate.id === elementId,
		);
		if (!removed) return;
		const action = m.engineering_removeElementAction({
			name: labels[removed.kind],
		});
		const message = m.engineering_deleted({ name: labels[removed.kind] });
		const deletionStep = session.commit(
			{
				...selectedStructure,
				elements: selectedStructure.elements.filter(
					(candidate) => candidate.id !== elementId,
				),
			},
			action,
		);
		setSelectedElementId(null);
		setAnnouncement(message);
		toast(message, {
			id: ENGINEERING_UNDO_TOAST_ID,
			action: {
				label: labels.undo,
				onClick: () => {
					if (deletionStep && session.history.isTop(deletionStep))
						replay("undo");
				},
			},
		});
	};
	const armTool = (tool: PlacementTool) => {
		if (paletteDisabledReason) return;
		const sameTool = JSON.stringify(tool) === JSON.stringify(placementTool);
		setPlacementTool(sameTool ? null : tool);
		setPrimitiveTarget("selection");
		if (!sameTool)
			setAnnouncement(
				m.engineering_placing({
					piece: "kind" in tool ? labels[tool.kind] : labels[tool.primitive],
				}),
			);
		else setAnnouncement(labels.cancel);
	};
	const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
		if (
			event.defaultPrevented ||
			event.repeat ||
			event.isComposing ||
			event.altKey ||
			!structuresActive ||
			isXrPresenting ||
			deleteOpen ||
			shortcutsOpen ||
			!isDesktopViewport ||
			(event.target instanceof Element &&
				event.target.closest(
					"input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox'],[role='dialog'],[role='alertdialog'],[role='menu'],[role='listbox']",
				))
		)
			return;
		const key = event.key.toLowerCase();
		if (event.ctrlKey || event.metaKey) {
			if (key === "z" || (event.ctrlKey && key === "y")) {
				event.preventDefault();
				replay(event.shiftKey || key === "y" ? "redo" : "undo");
			}
			return;
		}
		const paletteItem = paletteItems.find((item) => item.shortcut === key);
		if (paletteItem) {
			event.preventDefault();
			armTool(paletteItem.tool);
			return;
		}
		switch (key) {
			case "escape":
				event.preventDefault();
				if (placementTool) {
					setPlacementTool(null);
					setAnnouncement(labels.cancel);
				} else if (selectedElement) setSelectedElementId(null);
				else selectStructure(null);
				break;
			case "delete":
			case "backspace":
				if (selectedStructure) {
					event.preventDefault();
					if (selectedElement) deleteElement(selectedElement.id);
					else setDeleteOpen(true);
				}
				break;
			case "w":
				setTransformMode("translate");
				break;
			case "e":
				setTransformMode("rotate");
				break;
			case "r":
				setTransformMode("scale");
				break;
			case "f":
				if (selectedStructure)
					setCameraRequest({
						kind: "focus_structure",
						structureId: selectedStructure.id,
						requestId: ++cameraRequestId.current,
					});
				break;
			case "h":
				setCameraRequest({
					kind: "overview",
					requestId: ++cameraRequestId.current,
				});
				break;
			case "n":
				setCameraRequest({
					kind: "north_up",
					requestId: ++cameraRequestId.current,
				});
				break;
			case "?":
				event.preventDefault();
				setShortcutsOpen(true);
				break;
		}
	});
	useEffect(() => {
		const desktopMedia = matchMedia(
			`(min-width: ${ENGINEERING_DESKTOP_BREAKPOINT_PX}px)`,
		);
		const wideMedia = matchMedia(
			`(min-width: ${ENGINEERING_WIDE_BREAKPOINT_PX}px)`,
		);
		const updateViewport = () => {
			setDesktopViewport(desktopMedia.matches);
			setWideViewport(wideMedia.matches);
		};
		updateViewport();
		desktopMedia.addEventListener("change", updateViewport);
		wideMedia.addEventListener("change", updateViewport);
		window.addEventListener("keydown", handleShortcut);
		return () => {
			desktopMedia.removeEventListener("change", updateViewport);
			wideMedia.removeEventListener("change", updateViewport);
			window.removeEventListener("keydown", handleShortcut);
		};
	}, []);

	useEffect(() => {
		if (selectedId) setStructuresRequest((request) => request + 1);
	}, [selectedId]);

	const selectedName = selectedStructure?.name;
	useEffect(() => {
		if (selectedId && selectedName)
			setAnnouncement(m.engineering_selected({ name: selectedName }));
	}, [selectedId, selectedName]);

	const saveStatus = !isOnline
		? labels.offline
		: snapshot.save.failed
			? labels.notSaved
			: snapshot.save.pendingIds.size || snapshot.save.saving
				? labels.saving
				: snapshot.save.savedAt
					? m.engineering_saved({
							time: timeFormatter.format(snapshot.save.savedAt),
						})
					: labels.autosave;
	const elementRows =
		selectedStructure?.elements.map((candidate, _index, elements) => {
			const name = structureElementName(
				elements,
				candidate.id,
				labels[candidate.kind],
			);
			return {
				id: candidate.id,
				name,
				material: labels[candidate.material],
				deleteLabel: m.engineering_deleteElement({ name }),
			};
		}) ?? [];
	const elementName =
		elementRows.find((row) => row.id === selectedElement?.id)?.name ?? null;
	const deleteLabel = m.engineering_deleteType({
		kind: selectedStructure
			? labels[selectedStructure.template.kind]
			: labels.entity,
	});
	const fields = selectedStructure
		? structureEditorFields(
				selectedStructure,
				selectedElement,
				labels,
				locale,
				(structure, field) =>
					session.commit(structure, m.engineering_change({ name: field })),
			)
		: [];
	const xrAvailable = Boolean(
		structuresActive && selectedStructure && isArSupported,
	);
	const xrReason = !isArSupported
		? labels.xrUnsupported
		: selectedStructure
			? m.engineering_xrPreview({ name: selectedStructure.name })
			: labels.xrSelection;
	const leftWidthPx = isWideViewport
		? ENGINEERING_LEFT_PANEL_WIDTH_PX
		: ENGINEERING_COMPACT_PANEL_WIDTH_PX;
	const cursorReadout = cursor
		? `${cursor.point.lat.toFixed(ENGINEERING_COORDINATE_DIGITS)}, ${cursor.point.lng.toFixed(ENGINEERING_COORDINATE_DIGITS)} · ${m.engineering_elevation({ n: elevationFormatter.format(cursor.elevationM) })} · ${m.engineering_slope({ n: slopeFormatter.format(cursor.slopePercent) })}`
		: null;
	return (
		<>
			<StructureEditorHeader
				labels={labels}
				status={saveStatus}
				canUndo={snapshot.canUndo}
				canRedo={snapshot.canRedo}
				xrAvailable={xrAvailable}
				xrReason={xrReason}
				onUndo={() => replay("undo")}
				onRedo={() => replay("redo")}
				onEnterXr={() => {
					setXrRequest({ requestId: ++xrRequestId.current });
				}}
			>
				<SidebarTrigger className="md:hidden" aria-label={m.sidebar_toggle()} />
			</StructureEditorHeader>
			<div className="relative min-h-0 flex-1 overflow-hidden">
				<div
					ref={sceneContainer}
					tabIndex={-1}
					className="absolute inset-0 outline-none"
				>
					<XrViewer
						tilesBaseUrl={`${SERVER_URL}${TILES_API_PATH}`}
						weatherBaseUrl={`${SERVER_URL}${WEATHER_API_PATH}`}
						credentials="include"
						structuresLabel={m.engineering_openStructures()}
						openStructures={openStructures}
						terrainRetryRequest={terrainAttempt}
						overviewRequest={overviewRequest}
						structuresRequest={structuresRequest}
						failureLabel={m.engineering_viewerError()}
						onScreenChange={setViewerScreen}
						structures={{
							origin: PE22_TERRAIN_ORIGIN,
							landmarks: PE22_LANDMARKS,
							structures: snapshot.structures,
							selectedStructureId: selectedStructure?.id ?? null,
							selectedElementId: selectedElement?.id ?? null,
							hoveredStructureId,
							placementTool: paletteDisabledReason ? null : placementTool,
							primitiveTarget,
							transformMode,
							cameraRequest,
							exposureRing:
								selectedStructure && activePanelTab === "exposure"
									? {
											structureId: selectedStructure.id,
											radiusM: STRUCTURE_EXPOSURE_RADIUS_M,
										}
									: null,
							incidentMarkers: exposure.map(({ incident, point }) => ({
								id: incident.id,
								point,
								severity: incident.severity,
								label: incident.title,
							})),
							insets: {
								topPx: ENGINEERING_OVERLAY_GAP_PX,
								leftPx:
									leftWidthPx +
									ENGINEERING_OVERLAY_GAP_PX +
									ENGINEERING_OVERLAY_GAP_PX,
								rightPx: selectedStructure
									? ENGINEERING_RIGHT_PANEL_WIDTH_PX +
										ENGINEERING_OVERLAY_GAP_PX +
										ENGINEERING_OVERLAY_GAP_PX
									: ENGINEERING_OVERLAY_GAP_PX,
								bottomPx:
									ENGINEERING_BOTTOM_STRIP_HEIGHT_PX +
									ENGINEERING_OVERLAY_GAP_PX,
							},
							locale,
							xrRequest,
							onXrSupportChange: setIsArSupported,
							onXrSessionChange: setIsXrPresenting,
							labels: {
								canvas: labels.canvas,
								terrainError: m.engineering_sceneTerrainError(),
								outsideTerrain: labels.outsideTerrain,
								span: labels.span,
								heightDifference: labels.heightDifference,
								length: labels.length,
								slope: m.engineering_slopeLabel(),
								abutment: labels.abutment,
								portal: labels.portal,
								point: labels.point,
								placeTable: labels.xrPlace,
								undo: labels.undo,
								exitXr: labels.xrExit,
								backToMap: m.engineering_backToMap(),
							},
							onCreateStructure: (placed) => {
								const kind = placed.template.kind;
								const nameKind =
									kind === "entity" ? placed.elements[0]?.kind : undefined;
								const name = nextStructureName(
									snapshot.structures,
									kind,
									labels[nameKind ?? kind],
								);
								const structure: SceneStructure = {
									...placed,
									id: crypto.randomUUID(),
									name,
									status: "planned",
									notes: "",
								};
								session.commit(structure, m.engineering_createAction({ name }));
								selectStructure(structure.id);
								setPlacementTool(null);
								setAnnouncement(m.engineering_placed({ name }));
								sceneContainer.current?.focus({ preventScroll: true });
							},
							onStructureChange: (structure) => {
								session.commit(
									structure,
									m.engineering_change({ name: structure.name }),
								);
								if (
									primitiveArmed &&
									structure.elements.length >
										(selectedStructure?.elements.length ?? 0)
								) {
									setPlacementTool(null);
									setAnnouncement(
										m.engineering_placed({
											name: activeTool?.label ?? structure.name,
										}),
									);
								}
							},
							onSelectStructure: selectStructure,
							onSelectElement: (id) => {
								setSelectedElementId(id);
								setActivePanelTab("parameters");
							},
							onCursorChange: setCursor,
							onUndo: () => replay("undo"),
							onTerrainStatusChange: (status) => {
								setTerrainStatus(status);
								if (status === "ready") setTerrainWasReady(true);
							},
						}}
						className="size-full"
					/>
				</div>
				{structuresActive && !isDesktopViewport && (
					<div className="absolute inset-0 flex flex-col bg-background">
						<Button
							variant="outline"
							size="sm"
							className="m-3 self-start"
							onClick={() => setOverviewRequest((request) => request + 1)}
						>
							<MapIcon data-icon="inline-start" />
							{m.engineering_backToMap()}
						</Button>
						<StructureEditorPhoneNotice
							labels={labels}
							onCopy={async () => {
								try {
									await navigator.clipboard.writeText(window.location.href);
									toast.success(labels.copied);
								} catch {
									toast.error(labels.copyError);
								}
							}}
						/>
					</div>
				)}
				{structuresActive && isDesktopViewport && (
					<>
						<div
							className="pointer-events-none absolute flex"
							style={{
								top: ENGINEERING_OVERLAY_GAP_PX,
								left: ENGINEERING_OVERLAY_GAP_PX,
								right: ENGINEERING_OVERLAY_GAP_PX,
								bottom:
									ENGINEERING_BOTTOM_STRIP_HEIGHT_PX +
									ENGINEERING_OVERLAY_GAP_PX,
								gap: ENGINEERING_OVERLAY_GAP_PX,
							}}
						>
							<aside
								style={{ width: leftWidthPx }}
								className="pointer-events-auto flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border bg-card"
							>
								<StructureEditorPalette
									items={paletteItems}
									labels={labels}
									disabledReason={paletteDisabledReason}
									onArm={armTool}
								/>
								<StructureEditorList
									structures={snapshot.structures}
									selectedId={selectedStructure?.id ?? null}
									loading={query.isPending}
									failed={query.isLoadingError}
									labels={labels}
									onSelect={(id) => {
										selectStructure(id);
										setCameraRequest({
											kind: "focus_structure",
											structureId: id,
											requestId: ++cameraRequestId.current,
										});
									}}
									onHover={setHoveredStructureId}
									onRetry={() => {
										void query.refetch();
									}}
								/>
							</aside>
							<div
								className="flex min-w-0 flex-1 flex-col items-center"
								style={{ gap: ENGINEERING_OVERLAY_GAP_PX }}
							>
								<div className="flex w-full items-start justify-between gap-3">
									<Button
										variant="outline"
										size="sm"
										className="pointer-events-auto"
										onClick={() => setOverviewRequest((request) => request + 1)}
									>
										<MapIcon data-icon="inline-start" />
										{m.engineering_backToMap()}
									</Button>
									<StructureEditorCameraControls
										labels={labels}
										onNorth={() =>
											setCameraRequest({
												kind: "north_up",
												requestId: ++cameraRequestId.current,
											})
										}
										onOverview={() =>
											setCameraRequest({
												kind: "overview",
												requestId: ++cameraRequestId.current,
											})
										}
										onShortcuts={() => setShortcutsOpen(true)}
									/>
								</div>
								{snapshot.save.failed && (
									<StructureEditorNotice
										title={
											rejectedStructureId
												? m.engineering_rejectedEdit()
												: labels.saveError
										}
										detail={labels.saveErrorDetail}
										action={
											rejectedStructureId
												? m.engineering_discard()
												: labels.retry
										}
										onAction={() => {
											if (rejectedStructureId)
												session.discard(rejectedStructureId);
											else session.queue.retry();
										}}
										destructive
									/>
								)}
								{activeTool && (
									<StructureEditorBanner
										title={
											primitiveArmed
												? m.engineering_adding({ piece: activeTool.label })
												: m.engineering_placing({ piece: activeTool.label })
										}
										description={
											primitiveArmed && selectedStructure
												? labels.primitiveHelp
												: labels.placementHelp
										}
										labels={labels}
										selectedName={
											primitiveArmed ? (selectedStructure?.name ?? null) : null
										}
										primitiveTarget={primitiveTarget}
										onPrimitiveTarget={setPrimitiveTarget}
										onCancel={() => {
											setPlacementTool(null);
											setAnnouncement(labels.cancel);
										}}
									/>
								)}
								{terrainStatus === "loading" && (
									<StructureEditorNotice
										title={
											terrainWasReady
												? labels.terrainStreaming
												: labels.terrainLoading
										}
										detail={terrainWasReady ? "" : labels.terrainLoadingDetail}
									/>
								)}
								{terrainStatus === "error" && (
									<StructureEditorNotice
										title={labels.terrainError}
										detail={labels.terrainErrorDetail}
										action={labels.retry}
										onAction={() => {
											setTerrainStatus("loading");
											setXrRequest(null);
											setIsArSupported(false);
											setIsXrPresenting(false);
											setTerrainAttempt((attempt) => attempt + 1);
										}}
										destructive
									/>
								)}
								{selectedId && !selectedStructure && query.isSuccess && (
									<StructureEditorNotice
										title={labels.notFound}
										detail={labels.notFoundDetail}
										action={labels.allStructures}
										onAction={() => selectStructure(null)}
									/>
								)}
								{!placementTool && terrainStatus === "ready" && (
									<p className="type-data mt-auto rounded-md border bg-card/95 px-3 py-2 text-center text-muted-foreground">
										{labels.idle}
									</p>
								)}
							</div>
							{selectedStructure && (
								<StructureEditorParameters
									key={selectedStructure.id}
									widthPx={ENGINEERING_RIGHT_PANEL_WIDTH_PX}
									locale={locale}
									kind={selectedStructure.template.kind}
									primitiveKind={selectedStructure.elements[0]?.kind}
									name={selectedStructure.name}
									subtitle={`${labels[selectedStructure.template.kind]} · ${m.engineering_elementCount({ n: countFormatter.format(selectedStructure.elements.length) })}`}
									labels={labels}
									fields={fields}
									elements={elementRows}
									elementName={elementName}
									transformMode={transformMode}
									exposureCount={exposure.length}
									activePanelTab={activePanelTab}
									deleteLabel={deleteLabel}
									onTabChange={(nextTab) => {
										setActivePanelTab(nextTab);
										if (nextTab === "exposure")
											setCameraRequest({
												kind: "frame_exposure",
												structureId: selectedStructure.id,
												radiusM: STRUCTURE_EXPOSURE_RADIUS_M,
												requestId: ++cameraRequestId.current,
											});
									}}
									onClose={() => selectStructure(null)}
									onReleaseElement={() => setSelectedElementId(null)}
									onSelectElement={setSelectedElementId}
									onDeleteElement={deleteElement}
									onTransformMode={setTransformMode}
									onDelete={() => setDeleteOpen(true)}
									exposure={
										<StructureEditorExposure
											rows={exposure.map(({ incident, distanceM }) => ({
												id: incident.id,
												title: incident.title,
												severity: incident.severity,
												severityLabel: labels[incident.severity],
												distance: `${distanceFormatter.format(distanceM / METERS_PER_KM)} km`,
												source: `${INCIDENT_SOURCE_LABELS[incident.source] ?? incident.source} · ${timeFormatter.format(incident.occurredAt ?? incident.lastChangedAt)}`,
											}))}
											lead={
												exposure.length
													? m.engineering_exposureLead({
															n: countFormatter.format(exposure.length),
														})
													: labels.exposureEmpty
											}
											source={m.engineering_exposureSource({
												time: incidentsQuery.dataUpdatedAt
													? timeFormatter.format(incidentsQuery.dataUpdatedAt)
													: "—",
											})}
											loading={incidentsQuery.isPending}
											failed={incidentsQuery.isError}
											labels={labels}
											onRetry={() => {
												void incidentsQuery.refetch();
											}}
											onFocus={(id) => {
												const incident = exposure.find(
													(candidate) => candidate.incident.id === id,
												);
												if (incident)
													setCameraRequest({
														kind: "focus_point",
														point: incident.point,
														requestId: ++cameraRequestId.current,
													});
											}}
										/>
									}
								/>
							)}
						</div>
						<StructureEditorAttribution
							heightPx={ENGINEERING_BOTTOM_STRIP_HEIGHT_PX}
							cursor={cursorReadout}
						/>
					</>
				)}
			</div>
			{selectedStructure && (
				<StructureEditorConfirmDialog
					open={deleteOpen}
					title={m.engineering_deleteTitle({ name: selectedStructure.name })}
					description={
						selectedStructure.elements.length
							? m.engineering_deleteDetail({
									name: selectedStructure.name,
									n: countFormatter.format(selectedStructure.elements.length),
								})
							: m.engineering_deleteEmptyDetail({
									name: selectedStructure.name,
								})
					}
					action={deleteLabel}
					labels={labels}
					onOpenChange={setDeleteOpen}
					onConfirm={() => {
						session.deleteStructure(selectedStructure.id);
						setDeleteOpen(false);
						selectStructure(null);
						const message = m.engineering_deleted({
							name: selectedStructure.name,
						});
						toast(message);
						setAnnouncement(message);
					}}
				/>
			)}
			<StructureEditorShortcutsDialog
				open={shortcutsOpen}
				labels={labels}
				onOpenChange={setShortcutsOpen}
			/>
			<div aria-live="polite" aria-atomic="true" className="sr-only">
				{announcement}
			</div>
		</>
	);
}
