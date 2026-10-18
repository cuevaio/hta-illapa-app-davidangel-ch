import type { Terrain } from "@hack-the-andes-project/terrain/types";
import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import type { StructurePoint } from "../../lib/structure-scene";
import {
	ROAD_LIFT_M,
	ROAD_MARKING_LIFT_M,
	ROAD_SAMPLE_SPACING_M,
} from "./constants";

export interface RoadGeometryOptions {
	points: StructurePoint[];
	widthM: number;
	laneCount: number;
	laneWidthM: number;
	anchor: StructurePoint;
	terrain: Terrain;
}
interface RoadMarking {
	laneOffsetM: number;
	segments: [number, number, number][][];
}
export interface RoadGeometry {
	geometry: BufferGeometry;
	markings: RoadMarking[];
	leftEdges: [number, number, number][][];
	rightEdges: [number, number, number][][];
}

function loadedSegments(
	points: (StructurePoint | null)[],
): [number, number, number][][] {
	const segments: [number, number, number][][] = [];
	let segment: [number, number, number][] = [];
	for (const point of points) {
		if (point) segment.push([point.x, point.y, point.z]);
		else {
			if (segment.length > 1) segments.push(segment);
			segment = [];
		}
	}
	if (segment.length > 1) segments.push(segment);
	return segments;
}

export function createRoadGeometry({
	points,
	widthM,
	laneCount,
	laneWidthM,
	anchor,
	terrain,
}: RoadGeometryOptions): RoadGeometry {
	const vertices: number[] = [];
	const indices: number[] = [];
	const samples: StructurePoint[] = [];
	const leftEdge: (StructurePoint | null)[] = [];
	const rightEdge: (StructurePoint | null)[] = [];
	for (let pointIndex = 1; pointIndex < points.length; pointIndex++) {
		const previous = points[pointIndex - 1];
		const next = points[pointIndex];
		if (!previous || !next) continue;
		const segmentLengthM = Math.hypot(next.x - previous.x, next.z - previous.z);
		const steps = Math.max(
			1,
			Math.ceil(segmentLengthM / ROAD_SAMPLE_SPACING_M),
		);
		for (let step = pointIndex === 1 ? 0 : 1; step <= steps; step++)
			samples.push({
				x: previous.x + ((next.x - previous.x) * step) / steps,
				z: previous.z + ((next.z - previous.z) * step) / steps,
				y: 0,
			});
	}
	for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++) {
		const sample = samples[sampleIndex];
		const previous = samples[Math.max(0, sampleIndex - 1)];
		const next = samples[Math.min(samples.length - 1, sampleIndex + 1)];
		if (!sample || !previous || !next) continue;
		const direction = new Vector3(
			next.x - previous.x,
			0,
			next.z - previous.z,
		).normalize();
		const centerHeightM = terrain.heightAt({
			x: sample.x + anchor.x,
			z: sample.z + anchor.z,
		});
		for (const side of [-1, 1]) {
			const eastM = sample.x - ((direction.z * widthM) / 2) * side;
			const southM = sample.z + ((direction.x * widthM) / 2) * side;
			const heightM = terrain.heightAt({
				x: eastM + anchor.x,
				z: southM + anchor.z,
			});
			const point =
				heightM === null || centerHeightM === null
					? null
					: { x: eastM, y: heightM - anchor.y + ROAD_LIFT_M, z: southM };
			vertices.push(eastM, point?.y ?? 0, southM);
			(side === -1 ? leftEdge : rightEdge).push(point);
		}
		if (
			sampleIndex > 0 &&
			leftEdge[sampleIndex] &&
			rightEdge[sampleIndex] &&
			leftEdge[sampleIndex - 1] &&
			rightEdge[sampleIndex - 1]
		) {
			const vertexIndex = sampleIndex * 2;
			indices.push(
				vertexIndex - 2,
				vertexIndex,
				vertexIndex - 1,
				vertexIndex - 1,
				vertexIndex,
				vertexIndex + 1,
			);
		}
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
	geometry.setIndex(indices);
	geometry.computeVertexNormals();
	const markings = Array.from(
		{ length: Math.max(1, laneCount - 1) },
		(_, laneIndex) => {
			const laneOffsetM =
				laneCount === 1 ? 0 : (laneIndex + 1 - laneCount / 2) * laneWidthM;
			const markingPoints = samples.map(
				(sample, sampleIndex): StructurePoint | null => {
					const previous = samples[Math.max(0, sampleIndex - 1)] ?? sample;
					const next =
						samples[Math.min(samples.length - 1, sampleIndex + 1)] ?? sample;
					const direction = new Vector3(
						next.x - previous.x,
						0,
						next.z - previous.z,
					).normalize();
					const eastM = sample.x - direction.z * laneOffsetM;
					const southM = sample.z + direction.x * laneOffsetM;
					const heightM = terrain.heightAt({
						x: eastM + anchor.x,
						z: southM + anchor.z,
					});
					return heightM === null
						? null
						: {
								x: eastM,
								y: heightM - anchor.y + ROAD_LIFT_M + ROAD_MARKING_LIFT_M,
								z: southM,
							};
				},
			);
			return { laneOffsetM, segments: loadedSegments(markingPoints) };
		},
	);
	return {
		geometry,
		markings,
		leftEdges: loadedSegments(leftEdge),
		rightEdges: loadedSegments(rightEdge),
	};
}
