import type { CorridorLandmark } from "@hack-the-andes-project/business/structures/landmarks";
import type { Terrain } from "@hack-the-andes-project/terrain/types";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";
import type { SceneStructure } from "../../lib/structure-scene";
import {
	LANDMARK_FADE_START_DISTANCE_M,
	LANDMARK_LIFT_M,
	LANDMARK_MAX_DISTANCE_M,
	LANDMARK_STRUCTURE_CLEARANCE_PX,
	LANDMARK_Z_INDEX,
	STRUCTURE_LABEL_LIFT_M,
} from "./constants";

interface LandmarkProps {
	landmark: CorridorLandmark;
	terrain: Terrain;
	structures: SceneStructure[];
}
export function Landmark({ landmark, terrain, structures }: LandmarkProps) {
	const chip = useRef<HTMLDivElement>(null);
	const local = useMemo(() => terrain.toLocal(landmark), [terrain, landmark]);
	const anchors = useMemo(
		() =>
			structures.map((structure) => {
				const anchor = terrain.toLocal(structure.anchor);
				return new Vector3(
					anchor.x,
					structure.anchor.elevationM + STRUCTURE_LABEL_LIFT_M,
					anchor.z,
				);
			}),
		[terrain, structures],
	);
	const lastOpacity = useRef("");
	const heightM = terrain.heightAt(local);
	const position = new Vector3(
		local.x,
		(heightM ?? 0) + LANDMARK_LIFT_M,
		local.z,
	);
	const projectedPosition = useRef(new Vector3());
	const projectedStructure = useRef(new Vector3());
	useFrame(({ camera, size, gl }) => {
		if (!chip.current) return;
		const distanceM = position.distanceTo(camera.position);
		const opacity = Math.min(
			1,
			Math.max(
				0,
				(LANDMARK_MAX_DISTANCE_M - distanceM) /
					(LANDMARK_MAX_DISTANCE_M - LANDMARK_FADE_START_DISTANCE_M),
			),
		);
		projectedPosition.current.copy(position).project(camera);
		const overlaps = anchors.some((anchor) => {
			projectedStructure.current.copy(anchor).project(camera);
			return (
				Math.hypot(
					((projectedPosition.current.x - projectedStructure.current.x) *
						size.width) /
						2,
					((projectedPosition.current.y - projectedStructure.current.y) *
						size.height) /
						2,
				) < LANDMARK_STRUCTURE_CLEARANCE_PX
			);
		});
		const nextOpacity =
			gl.xr.isPresenting || heightM === null || overlaps
				? "0"
				: String(opacity);
		if (nextOpacity !== lastOpacity.current) {
			chip.current.style.opacity = nextOpacity;
			lastOpacity.current = nextOpacity;
		}
	});
	return (
		<Html
			position={position}
			center
			zIndexRange={[LANDMARK_Z_INDEX, 0]}
			style={{ pointerEvents: "none" }}
		>
			<div
				ref={chip}
				className="type-data whitespace-nowrap rounded-sm border bg-card/85 px-2 py-1 text-muted-foreground"
			>
				{landmark.name}
			</div>
		</Html>
	);
}
