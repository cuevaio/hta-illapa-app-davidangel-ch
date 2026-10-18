import { bypassWidthM } from "@hack-the-andes-project/business/structures/geometry";
import type { Terrain } from "@hack-the-andes-project/terrain/types";
import type { ThreeEvent } from "@react-three/fiber";
import { memo, useEffect, useMemo } from "react";
import {
	DoubleSide,
	ExtrudeGeometry,
	MathUtils,
	Path,
	Quaternion,
	Shape,
	Vector3,
} from "three";
import type {
	PlacedStructure,
	StructureElement,
	StructurePoint,
	TunnelTemplate,
} from "../../lib/structure-scene";
import {
	ABUTMENT_DEPTH_M,
	COLUMN_SEGMENTS_COUNT,
	DECK_THICKNESS_M,
	FULL_TURN_RAD,
	MATERIAL_ROUGHNESS_RATIO,
	MATERIAL_TOKEN_NAMES,
	MIN_GEOMETRY_LENGTH_M,
	OUTLINE_RENDER_ORDER,
	PIER_WIDTH_M,
	RAIL_HEIGHT_M,
	RAIL_WIDTH_PX,
	ROAD_DASH_GAP_M,
	ROAD_DASH_M,
	ROAD_MARKING_WIDTH_PX,
	SELECTION_LINE_WIDTH_PX,
	STEEL_METALNESS_RATIO,
	TUNNEL_ARC_SEGMENTS_COUNT,
	TUNNEL_ARCH_WALL_RATIO,
	TUNNEL_LINING_M,
	TUNNEL_PORTAL_DEPTH_M,
} from "./constants";
import { DecorativeEdges, DecorativeLine } from "./decorations";
import { createRoadGeometry } from "./road-geometry";

interface OutlineProps {
	color: string;
	opacity: number;
}
function Outline({ color, opacity }: OutlineProps) {
	return (
		<DecorativeEdges
			renderOrder={OUTLINE_RENDER_ORDER}
			color={color}
			transparent
			opacity={opacity}
			lineWidth={SELECTION_LINE_WIDTH_PX}
			depthTest={false}
			depthWrite={false}
		/>
	);
}

export interface ScenePalette {
	color(token: string): string;
}

interface SolidProps {
	color: string;
	highlight?: string;
	opacity?: number;
	highlightOpacity?: number;
}
interface SpanProps extends SolidProps {
	start: StructurePoint;
	end: StructurePoint;
	widthM: number;
	heightM: number;
}

function Span({
	start,
	end,
	widthM,
	heightM,
	color,
	highlight,
	highlightOpacity = 1,
	opacity = 1,
}: SpanProps) {
	const { position, rotation, lengthM } = useMemo(() => {
		const startVector = new Vector3(start.x, start.y, start.z);
		const endVector = new Vector3(end.x, end.y, end.z);
		const direction = endVector.clone().sub(startVector);
		const lengthM = Math.max(direction.length(), MIN_GEOMETRY_LENGTH_M);
		const rotation = new Quaternion().setFromUnitVectors(
			new Vector3(0, 0, 1),
			direction.normalize(),
		);
		return {
			position: startVector.add(endVector).multiplyScalar(0.5),
			rotation,
			lengthM,
		};
	}, [start.x, start.y, start.z, end.x, end.y, end.z]);
	return (
		<mesh
			name="structure-bridge-deck"
			position={position}
			scale={[widthM, heightM, lengthM]}
			quaternion={rotation}
		>
			<boxGeometry />
			<meshStandardMaterial
				color={color}
				roughness={MATERIAL_ROUGHNESS_RATIO}
				transparent={opacity < 1}
				opacity={opacity}
			/>
			{highlight && <Outline color={highlight} opacity={highlightOpacity} />}
		</mesh>
	);
}

interface PrimitiveModelProps extends SolidProps {
	element: StructureElement;
}
export function PrimitiveModel({
	element,
	color,
	highlight,
	highlightOpacity = 1,
	opacity = 1,
}: PrimitiveModelProps) {
	return (
		<mesh
			position={[0, element.heightM / 2, 0]}
			scale={[
				1,
				1,
				element.kind === "column" ? element.depthM / element.widthM : 1,
			]}
		>
			{element.kind === "column" ? (
				<cylinderGeometry
					args={[
						element.widthM / 2,
						element.widthM / 2,
						element.heightM,
						COLUMN_SEGMENTS_COUNT,
					]}
				/>
			) : (
				<boxGeometry args={[element.widthM, element.heightM, element.depthM]} />
			)}
			<meshStandardMaterial
				color={color}
				roughness={MATERIAL_ROUGHNESS_RATIO}
				metalness={element.material === "steel" ? STEEL_METALNESS_RATIO : 0}
				transparent={opacity < 1}
				opacity={opacity}
			/>
			{highlight && <Outline color={highlight} opacity={highlightOpacity} />}
		</mesh>
	);
}

interface TunnelBoreProps extends SolidProps {
	template: TunnelTemplate;
}
function TunnelBore({
	template,
	color,
	highlight,
	highlightOpacity = 1,
	opacity = 1,
}: TunnelBoreProps) {
	const { start, rotation, lengthM } = useMemo(() => {
		const start = new Vector3(
			template.start.x,
			template.start.y,
			template.start.z,
		);
		const end = new Vector3(template.end.x, template.end.y, template.end.z);
		const direction = end.clone().sub(start);
		const lengthM = Math.max(direction.length(), MIN_GEOMETRY_LENGTH_M);
		const rotation = new Quaternion().setFromUnitVectors(
			new Vector3(0, 0, 1),
			direction.normalize(),
		);
		return { start, rotation, lengthM };
	}, [template.start, template.end]);
	const geometries = useMemo(() => {
		const section = new Shape();
		const opening = new Path();
		const widthM = template.sectionWidthM;
		const heightM = template.sectionHeightM;
		if (template.shape === "circular") {
			section.absellipse(
				0,
				heightM / 2,
				widthM / 2 + TUNNEL_LINING_M,
				heightM / 2 + TUNNEL_LINING_M,
				0,
				FULL_TURN_RAD,
				false,
				0,
			);
			opening.absellipse(
				0,
				heightM / 2,
				widthM / 2,
				heightM / 2,
				0,
				FULL_TURN_RAD,
				true,
				0,
			);
		} else {
			const wallHeightM = heightM * TUNNEL_ARCH_WALL_RATIO;
			section.moveTo(-widthM / 2 - TUNNEL_LINING_M, -TUNNEL_LINING_M);
			section.lineTo(widthM / 2 + TUNNEL_LINING_M, -TUNNEL_LINING_M);
			section.lineTo(widthM / 2 + TUNNEL_LINING_M, wallHeightM);
			section.absellipse(
				0,
				wallHeightM,
				widthM / 2 + TUNNEL_LINING_M,
				heightM - wallHeightM + TUNNEL_LINING_M,
				0,
				Math.PI,
				false,
				0,
			);
			section.closePath();
			opening.moveTo(-widthM / 2, 0);
			opening.lineTo(-widthM / 2, wallHeightM);
			opening.absellipse(
				0,
				wallHeightM,
				widthM / 2,
				heightM - wallHeightM,
				Math.PI,
				0,
				true,
				0,
			);
			opening.lineTo(widthM / 2, 0);
			opening.closePath();
		}
		section.holes.push(opening);
		return {
			bore: new ExtrudeGeometry(section, {
				depth: 1,
				bevelEnabled: false,
				curveSegments: TUNNEL_ARC_SEGMENTS_COUNT,
			}),
			portal: new ExtrudeGeometry(section, {
				depth: TUNNEL_PORTAL_DEPTH_M,
				bevelEnabled: false,
				curveSegments: TUNNEL_ARC_SEGMENTS_COUNT,
			}),
		};
	}, [template.sectionWidthM, template.sectionHeightM, template.shape]);
	useEffect(
		() => () => {
			geometries.bore.dispose();
			geometries.portal.dispose();
		},
		[geometries],
	);
	return (
		<group position={start} quaternion={rotation}>
			<mesh geometry={geometries.bore} scale={[1, 1, lengthM]}>
				{highlight && <Outline color={highlight} opacity={highlightOpacity} />}
				<meshStandardMaterial
					color={color}
					side={DoubleSide}
					opacity={opacity}
					transparent={opacity < 1}
				/>
			</mesh>
			{[0, lengthM - TUNNEL_PORTAL_DEPTH_M].map((distanceM) => (
				<mesh
					key={distanceM === 0 ? "start" : "end"}
					position={[0, 0, distanceM]}
					geometry={geometries.portal}
				>
					<meshStandardMaterial
						color={color}
						opacity={opacity}
						transparent={opacity < 1}
					/>
					<Outline color={highlight ?? color} opacity={highlightOpacity} />
				</mesh>
			))}
		</group>
	);
}

interface RoadProps extends SolidProps {
	points: StructurePoint[];
	widthM: number;
	laneCount: number;
	laneWidthM: number;
	anchor: StructurePoint;
	terrain: Terrain;
	terrainRevision: number;
	markingColor: string;
}
function Road({
	points,
	widthM,
	laneCount,
	laneWidthM,
	anchor,
	terrain,
	color,
	markingColor,
	terrainRevision,
	highlight,
	highlightOpacity = 1,
	opacity = 1,
}: RoadProps) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: terrainRevision invalidates mutable terrain height samples.
	const { geometry, markings, leftEdges, rightEdges } = useMemo(() => {
		return createRoadGeometry({
			points,
			widthM,
			laneCount,
			laneWidthM,
			anchor,
			terrain,
		});
	}, [points, widthM, laneCount, laneWidthM, anchor, terrain, terrainRevision]);
	useEffect(() => () => geometry.dispose(), [geometry]);
	return (
		<group>
			<mesh name="structure-road" geometry={geometry}>
				<meshStandardMaterial
					side={DoubleSide}
					color={color}
					transparent={opacity < 1}
					opacity={opacity}
				/>
			</mesh>
			{markings.flatMap((marking) =>
				marking.segments.map((segment) => (
					<DecorativeLine
						key={`${marking.laneOffsetM}:${segment[0]?.join(":")}`}
						points={segment}
						color={markingColor}
						dashed
						dashSize={ROAD_DASH_M}
						gapSize={ROAD_DASH_GAP_M}
						lineWidth={ROAD_MARKING_WIDTH_PX}
					/>
				)),
			)}
			{highlight &&
				[...leftEdges, ...rightEdges].map((segment) => (
					<DecorativeLine
						key={segment[0]?.join(":")}
						transparent
						opacity={highlightOpacity}
						points={segment}
						depthTest={false}
						renderOrder={OUTLINE_RENDER_ORDER}
						depthWrite={false}
						color={highlight}
						lineWidth={SELECTION_LINE_WIDTH_PX}
					/>
				))}
		</group>
	);
}

interface StructureModelProps {
	structure: PlacedStructure;
	terrain: Terrain;
	palette: ScenePalette;
	highlight?: string;
	opacity?: number;
	highlightOpacity?: number;
	selectedElementId?: string | null;
	onElementClick?: (
		elementId: string,
		event: ThreeEvent<MouseEvent>,
		structureId?: string,
	) => void;
	structureId?: string;
	hideElementId?: string | null;
	terrainRevision?: number;
}
export const StructureModel = memo(function StructureModel({
	structure,
	terrain,
	palette,
	highlight,
	opacity = 1,
	onElementClick,
	structureId,
	selectedElementId,
	hideElementId,
	terrainRevision = 0,
	highlightOpacity = 1,
}: StructureModelProps) {
	const localAnchor = useMemo(
		() => terrain.toLocal(structure.anchor),
		[terrain, structure.anchor],
	);
	const anchor = useMemo(
		() => ({
			x: localAnchor.x,
			y: structure.anchor.elevationM,
			z: localAnchor.z,
		}),
		[localAnchor.x, localAnchor.z, structure.anchor.elevationM],
	);
	const template = structure.template;
	const concreteColor = palette.color(MATERIAL_TOKEN_NAMES.concrete);
	const deckColor =
		template.kind === "bridge"
			? palette.color(MATERIAL_TOKEN_NAMES[template.deckMaterial])
			: concreteColor;
	const bridgePiers = useMemo(
		() =>
			template.kind === "bridge"
				? Array.from({ length: template.pierCount }, (_, pierIndex) => {
						const fraction = (pierIndex + 1) / (template.pierCount + 1);
						return {
							x:
								template.start.x +
								(template.end.x - template.start.x) * fraction,
							y:
								template.start.y +
								(template.end.y - template.start.y) * fraction,
							z:
								template.start.z +
								(template.end.z - template.start.z) * fraction,
						};
					})
				: [],
		[template],
	);
	const railings = useMemo(
		() =>
			template.kind === "bridge"
				? [-1, 1].map((side) => {
						const direction = new Vector3(
							template.end.x - template.start.x,
							0,
							template.end.z - template.start.z,
						).normalize();
						return [template.start, template.end].map(
							(point): [number, number, number] => [
								point.x - ((direction.z * template.deckWidthM) / 2) * side,
								point.y + RAIL_HEIGHT_M,
								point.z + ((direction.x * template.deckWidthM) / 2) * side,
							],
						);
					})
				: [],
		[template],
	);
	return (
		<group position={[anchor.x, anchor.y, anchor.z]}>
			{template.kind === "bridge" && (
				<>
					<Span
						start={{
							...template.start,
							y: template.start.y - DECK_THICKNESS_M / 2,
						}}
						end={{ ...template.end, y: template.end.y - DECK_THICKNESS_M / 2 }}
						widthM={template.deckWidthM}
						heightM={DECK_THICKNESS_M}
						color={deckColor}
						highlight={highlight}
						highlightOpacity={highlightOpacity}
						opacity={opacity}
					/>
					{[template.start, template.end, ...bridgePiers].map(
						(point, pierIndex) => {
							const groundM =
								(terrain.heightAt({
									x: point.x + anchor.x,
									z: point.z + anchor.z,
								}) ?? anchor.y) - anchor.y;
							const heightM = Math.max(
								DECK_THICKNESS_M,
								point.y - groundM - DECK_THICKNESS_M,
							);
							return (
								<mesh
									key={pierIndex}
									scale={[
										pierIndex < 2 ? template.deckWidthM : PIER_WIDTH_M,
										heightM,
										pierIndex < 2 ? ABUTMENT_DEPTH_M : PIER_WIDTH_M,
									]}
									name={pierIndex < 2 ? "structure-abutment" : "structure-pier"}
									position={[
										point.x,
										point.y - DECK_THICKNESS_M - heightM / 2,
										point.z,
									]}
								>
									<boxGeometry />
									<meshStandardMaterial
										color={concreteColor}
										transparent={opacity < 1}
										opacity={opacity}
									/>
									{highlight && (
										<Outline color={highlight} opacity={highlightOpacity} />
									)}
								</mesh>
							);
						},
					)}
					{railings.map((railing, index) => (
						<DecorativeLine
							key={index}
							points={railing}
							color={palette.color(MATERIAL_TOKEN_NAMES.steel)}
							lineWidth={RAIL_WIDTH_PX}
						/>
					))}
				</>
			)}
			{template.kind === "tunnel" && (
				<TunnelBore
					template={template}
					color={concreteColor}
					highlight={highlight}
					highlightOpacity={highlightOpacity}
					opacity={opacity}
				/>
			)}
			{template.kind === "bypass" && (
				<Road
					terrainRevision={terrainRevision}
					points={template.points}
					widthM={bypassWidthM(template)}
					laneCount={template.laneCount}
					laneWidthM={template.laneWidthM}
					anchor={anchor}
					terrain={terrain}
					color={palette.color(MATERIAL_TOKEN_NAMES.asphalt)}
					markingColor={palette.color("--card")}
					highlight={highlight}
					highlightOpacity={highlightOpacity}
					opacity={opacity}
				/>
			)}
			{structure.elements
				.filter((element) => element.id !== hideElementId)
				.map((element) => (
					<group
						key={element.id}
						position={[
							element.position.x,
							element.position.y,
							element.position.z,
						]}
						rotation={[
							MathUtils.degToRad(element.rotationDeg.x),
							MathUtils.degToRad(element.rotationDeg.y),
							MathUtils.degToRad(element.rotationDeg.z),
						]}
						onClick={(event) =>
							onElementClick?.(element.id, event, structureId)
						}
					>
						<PrimitiveModel
							element={element}
							color={palette.color(MATERIAL_TOKEN_NAMES[element.material])}
							highlight={
								element.id === selectedElementId
									? palette.color("--primary")
									: highlight
							}
							opacity={opacity}
							highlightOpacity={highlightOpacity}
						/>
					</group>
				))}
		</group>
	);
});
