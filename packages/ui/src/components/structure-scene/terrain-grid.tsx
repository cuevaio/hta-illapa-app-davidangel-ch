import type {
	LocalPoint,
	Terrain,
} from "@hack-the-andes-project/terrain/types";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferGeometry, Float32BufferAttribute } from "three";
import {
	GRID_CELL_M,
	GRID_FADE_DISTANCE_M,
	GRID_FOLLOW_STEP_M,
	GRID_HEIGHT_PROBE_CELLS_COUNT,
	GRID_LIFT_M,
	GRID_MAJOR_CELL_M,
	GRID_MAJOR_OPACITY_RATIO,
	GRID_MINOR_OPACITY_RATIO,
	GRID_REFRESH_INTERVAL_MS,
	GRID_SIZE_M,
	TERRAIN_HEIGHT_CHANGE_EPSILON_M,
} from "./constants";

import { ignoreRaycast } from "./decorations";

export function createGridGeometry(): BufferGeometry {
	const geometry = new BufferGeometry();
	const sideCount = GRID_SIZE_M / GRID_CELL_M + 1;
	const indices: number[] = [];
	for (let row = 0; row < sideCount; row++) {
		for (let column = 0; column < sideCount; column++) {
			const index = row * sideCount + column;
			if (column + 1 < sideCount) indices.push(index, index + 1);
			if (row + 1 < sideCount)
				indices.push(
					index + sideCount * sideCount,
					index + sideCount * sideCount + sideCount,
				);
		}
	}
	geometry.setIndex(indices);
	geometry.setAttribute(
		"position",
		new Float32BufferAttribute(
			new Float32Array(sideCount * sideCount * 2 * 3),
			3,
		),
	);
	geometry.setAttribute(
		"color",
		new Float32BufferAttribute(
			new Float32Array(sideCount * sideCount * 2 * 4),
			4,
		),
	);
	return geometry;
}

export function drapeGridGeometry(
	geometry: BufferGeometry,
	terrain: Terrain,
	center: LocalPoint,
) {
	const positions = geometry.getAttribute("position");
	const colors = geometry.getAttribute("color");
	const sideCount = GRID_SIZE_M / GRID_CELL_M + 1;
	for (let row = 0; row < sideCount; row++) {
		for (let column = 0; column < sideCount; column++) {
			const eastOffsetM = column * GRID_CELL_M - GRID_SIZE_M / 2;
			const southOffsetM = row * GRID_CELL_M - GRID_SIZE_M / 2;
			const eastM = center.x + eastOffsetM;
			const southM = center.z + southOffsetM;
			const heightM = terrain.heightAt({ x: eastM, z: southM });
			const fade = Math.min(
				1,
				(GRID_SIZE_M / 2 -
					Math.max(Math.abs(eastOffsetM), Math.abs(southOffsetM))) /
					GRID_FADE_DISTANCE_M,
			);
			for (let axis = 0; axis < 2; axis++) {
				const index = row * sideCount + column + axis * sideCount * sideCount;
				const major = (axis === 0 ? southM : eastM) % GRID_MAJOR_CELL_M === 0;
				const opacity =
					heightM === null
						? 0
						: fade *
							(major ? GRID_MAJOR_OPACITY_RATIO : GRID_MINOR_OPACITY_RATIO);
				positions.setXYZ(index, eastM, (heightM ?? 0) + GRID_LIFT_M, southM);
				colors.setXYZW(index, 1, 1, 1, opacity);
			}
		}
	}
	positions.needsUpdate = true;
	colors.needsUpdate = true;
	geometry.computeBoundingSphere();
}

interface TerrainGridProps {
	terrain: Terrain;
	center: LocalPoint;
	color: string;
	terrainRevision: number;
}
export function TerrainGrid({
	terrain,
	center,
	color,
	terrainRevision,
}: TerrainGridProps) {
	const geometry = useMemo(createGridGeometry, []);
	const latest = useRef({ center, terrainRevision });
	latest.current = { center, terrainRevision };
	const previous = useRef<{ x: number; z: number; revision: number } | null>(
		null,
	);
	const heightSamples = useRef<(number | null)[]>([]);
	const refreshedAtMs = useRef(Number.NEGATIVE_INFINITY);
	useFrame(() => {
		if (performance.now() - refreshedAtMs.current < GRID_REFRESH_INTERVAL_MS)
			return;
		refreshedAtMs.current = performance.now();
		const current = latest.current;
		const eastM =
			Math.round(current.center.x / GRID_FOLLOW_STEP_M) * GRID_FOLLOW_STEP_M;
		const southM =
			Math.round(current.center.z / GRID_FOLLOW_STEP_M) * GRID_FOLLOW_STEP_M;
		const samples: (number | null)[] = [];
		for (let row = 0; row <= GRID_HEIGHT_PROBE_CELLS_COUNT; row++) {
			for (let column = 0; column <= GRID_HEIGHT_PROBE_CELLS_COUNT; column++)
				samples.push(
					terrain.heightAt({
						x:
							eastM -
							GRID_SIZE_M / 2 +
							(column * GRID_SIZE_M) / GRID_HEIGHT_PROBE_CELLS_COUNT,
						z:
							southM -
							GRID_SIZE_M / 2 +
							(row * GRID_SIZE_M) / GRID_HEIGHT_PROBE_CELLS_COUNT,
					}),
				);
		}
		const heightsChanged = samples.some((height, index) => {
			const previousHeight = heightSamples.current[index];
			return height === null || previousHeight == null
				? height !== previousHeight
				: Math.abs(height - previousHeight) > TERRAIN_HEIGHT_CHANGE_EPSILON_M;
		});
		heightSamples.current = samples;
		if (
			!heightsChanged &&
			previous.current?.x === eastM &&
			previous.current.z === southM &&
			previous.current.revision === current.terrainRevision
		)
			return;
		drapeGridGeometry(geometry, terrain, { x: eastM, z: southM });
		previous.current = {
			x: eastM,
			z: southM,
			revision: current.terrainRevision,
		};
		refreshedAtMs.current = performance.now();
	});
	useEffect(() => () => geometry.dispose(), [geometry]);
	return (
		<lineSegments
			geometry={geometry}
			raycast={ignoreRaycast}
			pointerEvents="none"
		>
			<lineBasicMaterial
				color={color}
				vertexColors
				transparent
				depthWrite={false}
			/>
		</lineSegments>
	);
}
