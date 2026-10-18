import type { RouteRiskHorizon } from "@hack-the-andes-project/business/route-review/risk";
import { cn } from "cn";
import type { FeatureCollection, LineString } from "geojson";
import {
	useEffect,
	useEffectEvent,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTokenColors } from "../hooks/use-token-colors";
import type {
	RouteReviewCandidate,
	RouteReviewLabels,
} from "../lib/route-review";
import { Badge } from "./badge";
import { Button } from "./button";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "./drawer";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";
import {
	FLEET_ALTERNATIVE_DASH_WIDTH_RATIOS,
	FLEET_MAP_FIT_DURATION_MS,
	FLEET_MAP_MAX_ZOOM_LEVEL,
	ROUTE_REVIEW_INELIGIBLE_LINE_OPACITY_RATIO,
} from "./map-constants";
import {
	Layer,
	type MapRef,
	MapView,
	Marker,
	NavigationControl,
	Popup,
	Source,
} from "./map-view";
import { RouteReviewLegend } from "./route-review-legend";
import { RouteReviewSignalSymbol } from "./route-review-signal-symbol";
import { RouteReviewSignalTag } from "./route-review-signal-tag";
import { Spinner } from "./spinner";

interface RouteReviewMapPlace {
	name: string;
	lat: number;
	lng: number;
}
interface RouteReviewMapProps {
	candidates: RouteReviewCandidate[];
	selectedCandidateId: string | null;
	chosenCandidateId?: string;
	horizon: RouteRiskHorizon;
	origin: RouteReviewMapPlace;
	destination: RouteReviewMapPlace;
	onSelectCandidate: (id: string) => void;
	className?: string;
	labels: RouteReviewLabels;
	isBusy?: boolean;
	lineWidthPx: number;
	selectedLineWidthPx: number;
	casingWidthPx: number;
	fitPaddingPx: number;
	legendPaddingPx: number;
	compactLegendPaddingPx: number;
	compactHeightPx: number;
}
interface MapLineProperties {
	candidateId: string;
	color: string | undefined;
	description: string;
}
interface MapRouteLineProperties extends MapLineProperties {
	opacity: number;
}
interface MapHover {
	lng: number;
	lat: number;
	description: string;
}
function RouteReviewMapCanvas({
	candidates,
	selectedCandidateId,
	chosenCandidateId,
	horizon,
	origin,
	destination,
	onSelectCandidate,
	labels,
	lineWidthPx,
	selectedLineWidthPx,
	casingWidthPx,
	fitPaddingPx,
	legendPaddingPx,
	compactLegendPaddingPx,
	compactHeightPx,
}: RouteReviewMapProps) {
	const mapRef = useRef<MapRef>(null);
	const mapId = useId();
	const [ready, setReady] = useState(false);
	const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
	const [hover, setHover] = useState<MapHover | null>(null);
	const colors = useTokenColors([
		"--muted-foreground",
		"--foreground",
		"--background",
		"--card",
		"--risk-low",
		"--risk-moderate",
		"--risk-high",
		"--risk-critical",
	]);
	const selected = candidates.find(
		(candidate) => candidate.id === selectedCandidateId,
	);
	const chosen = candidates.find(
		(candidate) => candidate.id === chosenCandidateId,
	);
	const fitSelectedRoute = useEffectEvent(
		(
			candidateId: string | null,
			originPosition: [number, number],
			destinationPosition: [number, number],
			containerHeightPx: number,
		) => {
			const selectedCandidate = candidates.find(
				(candidate) => candidate.id === candidateId,
			);
			const positions = selectedCandidate?.geometry.coordinates ?? [
				originPosition,
				destinationPosition,
			];
			const longitudes = positions.flatMap((position) =>
				position[0] === undefined ? [] : [position[0]],
			);
			const latitudes = positions.flatMap((position) =>
				position[1] === undefined ? [] : [position[1]],
			);
			mapRef.current?.fitBounds(
				[
					[Math.min(...longitudes), Math.min(...latitudes)],
					[Math.max(...longitudes), Math.max(...latitudes)],
				],
				{
					padding: {
						top: fitPaddingPx,
						right: fitPaddingPx,
						bottom:
							containerHeightPx <= compactHeightPx
								? compactLegendPaddingPx
								: legendPaddingPx,
						left: fitPaddingPx,
					},
					maxZoom: FLEET_MAP_MAX_ZOOM_LEVEL,
					duration: FLEET_MAP_FIT_DURATION_MS,
				},
			);
		},
	);
	useEffect(() => {
		if (ready && viewportSize.width)
			fitSelectedRoute(
				selectedCandidateId,
				[origin.lng, origin.lat],
				[destination.lng, destination.lat],
				viewportSize.height,
			);
	}, [
		ready,
		selectedCandidateId,
		origin.lat,
		origin.lng,
		destination.lat,
		destination.lng,
		viewportSize.width,
		viewportSize.height,
	]);

	const layers = useMemo(
		() =>
			["illapa", "sutran"].map((source) => {
				const routes: FeatureCollection<LineString, MapRouteLineProperties> = {
					type: "FeatureCollection",
					features: candidates
						.filter((candidate) => candidate.source === source)
						.map((candidate) => ({
							type: "Feature",
							geometry: candidate.geometry,
							properties: {
								candidateId: candidate.id,
								color:
									colors[
										candidate.id === chosenCandidateId
											? "--foreground"
											: "--muted-foreground"
									],
								opacity:
									candidate.eligibility.eligible ||
									candidate.id === selectedCandidateId
										? 1
										: ROUTE_REVIEW_INELIGIBLE_LINE_OPACITY_RATIO,
								description: candidate.name,
							},
						})),
				};
				const segments: FeatureCollection<LineString, MapLineProperties> = {
					type: "FeatureCollection",
					features:
						selected?.source === source && selected.eligibility.eligible
							? selected.segments.map((segment) => {
									const risk = segment.risk.find(
										(assessment) => assessment.horizon === horizon,
									);
									return {
										type: "Feature",
										geometry: segment.geometry,
										properties: {
											candidateId: selected.id,
											color:
												colors[
													risk ? `--risk-${risk.level}` : "--muted-foreground"
												],
											description: `${labels.kmRange(segment.startM, segment.endM)} · ${risk ? `${labels.riskLevel(risk.level)} ${risk.score}` : ""} · ${labels.horizon(horizon)}`,
										},
									};
								})
							: [],
				};
				return { source, routes, segments };
			}),
		[
			candidates,
			selectedCandidateId,
			chosenCandidateId,
			selected,
			horizon,
			colors,
			labels,
		],
	);
	const interactiveLayerIds = layers.flatMap((layer) => [
		`${mapId}-${layer.source}-route`,
		`${mapId}-${layer.source}-risk`,
	]);
	return (
		<MapView
			ref={mapRef}
			cooperativeGestures
			onLoad={(event) => {
				const container = event.target.getContainer();
				setViewportSize({
					width: container.clientWidth,
					height: container.clientHeight,
				});
				setReady(true);
			}}
			onResize={(event) => {
				const container = event.target.getContainer();
				setViewportSize({
					width: container.clientWidth,
					height: container.clientHeight,
				});
			}}
			interactiveLayerIds={colors["--foreground"] ? interactiveLayerIds : []}
			onClick={(event) => {
				const candidateId = event.features?.[0]?.properties?.candidateId;
				if (typeof candidateId === "string") onSelectCandidate(candidateId);
			}}
			onMouseMove={(event) => {
				const description = event.features?.[0]?.properties?.description;
				setHover(
					typeof description === "string"
						? { ...event.lngLat, description }
						: null,
				);
			}}
			onMouseLeave={() => setHover(null)}
			cursor={hover ? "pointer" : undefined}
		>
			<NavigationControl position="top-right" />
			{colors["--foreground"] ? (
				<>
					{layers.map(({ source, routes }) => (
						<Source
							key={`${mapId}-${source}-routes`}
							id={`${mapId}-${source}-routes`}
							type="geojson"
							data={routes}
						>
							<Layer
								id={`${mapId}-${source}-route`}
								type="line"
								layout={{ "line-join": "round" }}
								paint={{
									"line-color": ["get", "color"],
									"line-opacity": ["get", "opacity"],
									"line-width": lineWidthPx,
									...(source === "sutran"
										? { "line-dasharray": FLEET_ALTERNATIVE_DASH_WIDTH_RATIOS }
										: {}),
								}}
							/>
						</Source>
					))}
					{layers.map(({ source, segments }) => (
						<Source
							key={`${mapId}-${source}-segments`}
							id={`${mapId}-${source}-segments`}
							type="geojson"
							data={segments}
						>
							<Layer
								id={`${mapId}-${source}-casing`}
								type="line"
								paint={{
									"line-color":
										colors[
											typeof document !== "undefined" &&
											document.documentElement.classList.contains("dark")
												? "--background"
												: "--foreground"
										],
									"line-width": casingWidthPx,
								}}
							/>
							<Layer
								id={`${mapId}-${source}-risk`}
								type="line"
								paint={{
									"line-color": ["get", "color"],
									"line-width": selectedLineWidthPx,
									...(source === "sutran"
										? { "line-dasharray": FLEET_ALTERNATIVE_DASH_WIDTH_RATIOS }
										: {}),
								}}
							/>
						</Source>
					))}
				</>
			) : null}
			{[
				{ place: origin, letter: "A" },
				{ place: destination, letter: "B" },
			].map(({ place, letter }) => (
				<Marker key={letter} latitude={place.lat} longitude={place.lng}>
					<span className="flex items-center gap-1 rounded-md border bg-card px-2 py-1 font-semibold text-card-foreground">
						{letter} · {place.name}
					</span>
				</Marker>
			))}
			{chosen && chosen.id !== selectedCandidateId ? (
				<Marker
					longitude={chosen.geometry.coordinates.at(-1)?.[0] ?? destination.lng}
					latitude={chosen.geometry.coordinates.at(-1)?.[1] ?? destination.lat}
					anchor="top"
				>
					<Badge variant="outline">
						{labels.chosen} · {chosen.name}
					</Badge>
				</Marker>
			) : null}
			{selected?.eligibility.eligible
				? selected.signals
						.filter((signal) => signal.kind !== "baseline")
						.map((signal) => {
							const signalSegments = selected.segments.filter((segment) =>
								signal.segmentIds.includes(segment.id),
							);
							const coordinates =
								signal.geometry?.type === "Point"
									? signal.geometry.coordinates
									: signalSegments[Math.floor(signalSegments.length / 2)]
											?.geometry.coordinates[0];
							if (
								!coordinates ||
								coordinates[0] === undefined ||
								coordinates[1] === undefined
							)
								return null;
							return (
								<Marker
									key={signal.id}
									longitude={coordinates[0]}
									latitude={coordinates[1]}
								>
									<HoverCard>
										<HoverCardTrigger
											render={<button type="button" />}
											aria-label={`${signal.title} · ${labels.signalKind(signal.kind)} · ${signal.source} ${labels.observedAt(signal.observedAt)}`}
											className="flex size-11 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:hover:scale-100"
										>
											<RouteReviewSignalSymbol
												signal={signal}
												signalSegments={signalSegments}
												horizon={horizon}
											/>
										</HoverCardTrigger>
										<HoverCardContent className="flex flex-col gap-2">
											<RouteReviewSignalTag
												kind={signal.kind}
												label={labels.signalKind(signal.kind)}
											/>
											<p className="font-semibold">{signal.title}</p>
											<p>
												{signal.source} ·{" "}
												<time dateTime={signal.observedAt.toISOString()}>
													{labels.observedAt(signal.observedAt)}
												</time>
											</p>
										</HoverCardContent>
									</HoverCard>
								</Marker>
							);
						})
				: null}
			{hover ? (
				<Popup
					longitude={hover.lng}
					latitude={hover.lat}
					closeButton={false}
					closeOnClick={false}
				>
					<p className="type-data">{hover.description}</p>
				</Popup>
			) : null}
		</MapView>
	);
}
export function RouteReviewMap(props: RouteReviewMapProps) {
	const [legendOpen, setLegendOpen] = useState(false);
	return (
		<section
			aria-label={props.labels.mapLabel}
			className={cn(
				"relative min-h-60 overflow-hidden rounded-lg border",
				props.className,
			)}
		>
			<RouteReviewMapCanvas {...props} />
			{props.isBusy ? (
				<div
					role="status"
					className="absolute top-3 left-3 flex items-center gap-2 rounded-md border bg-card p-2 text-sm"
				>
					<Spinner />
					{props.labels.calculating}
				</div>
			) : null}
			<div className="absolute inset-x-3 bottom-3 hidden xl:block">
				<RouteReviewLegend
					horizonLabel={props.labels.horizon(props.horizon)}
					labels={props.labels}
				/>
			</div>
			<div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2 xl:hidden">
				<div className="flex flex-col gap-2">
					{legendOpen ? (
						<RouteReviewLegend
							horizonLabel={props.labels.horizon(props.horizon)}
							labels={props.labels}
						/>
					) : null}
					<Button
						variant="outline"
						className="min-h-11 w-fit"
						aria-expanded={legendOpen}
						onClick={() => setLegendOpen(!legendOpen)}
					>
						{props.labels.legend}
					</Button>
				</div>
				<Drawer>
					<DrawerTrigger
						render={<Button variant="outline" className="min-h-11" />}
					>
						{props.labels.expand}
					</DrawerTrigger>
					<DrawerContent className="h-dvh! max-h-dvh! rounded-none!">
						<DrawerHeader>
							<DrawerTitle>{props.labels.mapLabel}</DrawerTitle>
							<DrawerClose
								render={<Button variant="outline" className="min-h-11" />}
							>
								{props.labels.close}
							</DrawerClose>
						</DrawerHeader>
						<div className="relative min-h-0 flex-1">
							<RouteReviewMapCanvas {...props} />
						</div>
						<RouteReviewLegend
							horizonLabel={props.labels.horizon(props.horizon)}
							labels={props.labels}
						/>
					</DrawerContent>
				</Drawer>
			</div>
		</section>
	);
}
