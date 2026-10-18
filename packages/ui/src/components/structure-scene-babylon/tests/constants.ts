import type { SceneStructure } from "../../../lib/structure-scene";

export const TEST_STRUCTURE: SceneStructure = {
	id: "bridge",
	name: "Puente PE-22",
	status: "planned",
	notes: "",
	anchor: { lat: -11.84, lng: -76.39, elevationM: 2_550 },
	template: {
		kind: "bridge",
		start: { x: -30, y: 0, z: 0 },
		end: { x: 30, y: 5, z: 0 },
		deckWidthM: 10,
		pierCount: 2,
		deckMaterial: "concrete",
	},
	elements: [
		{
			id: "column",
			kind: "column",
			material: "steel",
			position: { x: 2, y: 0, z: -3 },
			rotationDeg: { x: 15, y: 30, z: 45 },
			widthM: 2,
			heightM: 8,
			depthM: 4,
		},
	],
};
export const TEST_GROUND_M = 2_500;
export const TEST_VIEW_WIDTH_PX = 1_200;
export const TEST_VIEW_HEIGHT_PX = 800;
export const TEST_CHARACTER_WIDTH_PX = 7;
export const TEST_FONT_ASCENT_PX = 10;
export const TEST_FONT_DESCENT_PX = 3;
export const TEST_INSETS = {
	topPx: 40,
	rightPx: 400,
	bottomPx: 80,
	leftPx: 120,
};
export const TEST_ANCHOR_OFFSET_M = { x: 12.3, z: -8.1 };
export const TEST_CURSOR_M = { x: 19, y: TEST_GROUND_M, z: -14 };
export const TEST_SNAP_M = { x: 20, z: -15 };
export const TEST_TUNNEL_WIDTH_M = 10;
export const TEST_TUNNEL_HEIGHT_M = 8;
export const TEST_TUNNEL_LENGTH_M = 40;
export const TEST_RAY_START_M = -10;
export const TEST_ROAD_HALF_LENGTH_M = 20;
export const TEST_MISSING_DEM_HALF_WIDTH_M = 5;
export const TEST_GRADIENT_RATIO = 0.1;
export const TEST_TABLE_SCALE_RATIO = 0.01;
export const TEST_TABLE_POSITION_M = { x: 1, y: 1, z: -2 };
export const TEST_XYZ_ROTATIONS_DEG = [
	{ x: 15, y: 30, z: 45 },
	{ x: -170, y: -70, z: 130 },
	{ x: 30, y: 90, z: 60 },
];
export const TEST_CAMERA_SLOPE_RATIO = 2;
export const TEST_CAMERA_BYPASS_HALF_LENGTH_M = 500;
export const TEST_CAMERA_BYPASS_LANE_COUNT = 2;
export const TEST_CAMERA_BYPASS_LANE_WIDTH_M = 3;
export const TEST_CAMERA_FLIGHT_HALF_LENGTH_M = 1_000;
export const TEST_CAMERA_FLIGHT_ALTITUDE_M = 500;
export const TEST_CAMERA_RIDGE_HALF_WIDTH_M = 200;
export const TEST_CAMERA_RIDGE_HEIGHT_M = 1_500;
export const TEST_CAMERA_FLIGHT_STEPS_COUNT = 24;
export const TEST_CAMERA_MIN_CLEARANCE_M = 30;
export const TEST_CAMERA_CLEARANCE_RATIO = 0.1;
