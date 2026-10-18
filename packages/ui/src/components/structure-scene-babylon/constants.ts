export const DPR_MAX_RATIO = 2;
export const HALF_RATIO = 0.5;
export const DEGREES_PER_RADIAN = 180 / Math.PI;
export const EULER_SINGULARITY_RATIO = 0.9999999;
export const MARKING_SEGMENTS_COUNT = 3;
export const CAMERA_FOV_RAD = Math.PI / 4;
export const CAMERA_INITIAL_ALPHA_RAD = Math.PI / 4;
export const CAMERA_INITIAL_BETA_RAD = Math.PI / 3;
export const CAMERA_INITIAL_RADIUS_M = 3_000;
export const CAMERA_MIN_RADIUS_M = 50;
export const CAMERA_MAX_RADIUS_M = 30_000;
export const CAMERA_MAX_BETA_RAD = Math.PI / 2 - 0.05;
export const CAMERA_MIN_BETA_RAD = 0.05;
export const CAMERA_NEAR_M = 0.5;
export const CAMERA_FAR_M = 60_000;
export const CAMERA_MIN_FAR_M = 10_000;
export const CAMERA_NEAR_DISTANCE_RATIO = 0.001;
export const CAMERA_FAR_DISTANCE_RATIO = 2;
export const CAMERA_GROUND_CLEARANCE_M = 15;
export const CAMERA_FOCUS_FILL_RATIO = 0.45;
export const CAMERA_OVERVIEW_FILL_RATIO = 0.75;
export const CAMERA_FRAME_ITERATIONS_COUNT = 24;
export const CAMERA_FLIGHT_DURATION_MS = 800;
export const CAMERA_FLIGHT_EASE_EXPONENT = 3;
export const CAMERA_INERTIA_RATIO = 0.88;
export const CAMERA_WHEEL_PERCENTAGE_RATIO = 0.05;
export const INITIAL_ELEVATION_M = 2_500;
export const SKY_INTENSITY_RATIO = 1.2;
export const SUN_INTENSITY_RATIO = 1.5;
export const SUN_DIRECTION_M = { x: -3_000, y: -8_000, z: -4_000 };
export const FOG_START_M = 25_000;
export const FOG_END_M = 60_000;
export const TERRAIN_LOAD_TIMEOUT_MS = 30_000;
export const TERRAIN_REFRESH_INTERVAL_MS = 500;
export const HEIGHT_CHANGE_EPSILON_M = 0.05;
export const CURSOR_REPORT_INTERVAL_MS = 100;
export const CLICK_THRESHOLD_PX = 4;
export const XR_CLICK_THRESHOLD_M = 0.03;
export const DRAG_CLICK_SUPPRESSION_MS = 100;
export const GHOST_OPACITY_RATIO = 0.35;
export const HOVER_OPACITY_RATIO = 0.5;
export const TUNNEL_TERRAIN_OPACITY_RATIO = 0.35;
export const DECK_THICKNESS_M = 1.5;
export const ABUTMENT_DEPTH_M = 3;
export const PIER_WIDTH_M = 1.4;
export const RAIL_HEIGHT_M = 1.2;
export const RAIL_WIDTH_M = 0.12;
export const COLUMN_SEGMENTS_COUNT = 20;
export const MIN_GEOMETRY_LENGTH_M = 0.01;
export const TUNNEL_LINING_M = 0.6;
export const TUNNEL_PORTAL_DEPTH_M = 1;
export const TUNNEL_ARC_SEGMENTS_COUNT = 24;
export const TUNNEL_ARCH_WALL_RATIO = 0.5;
export const MATERIAL_ROUGHNESS_RATIO = 0.85;
export const STEEL_METALNESS_RATIO = 0.6;
export const ROAD_SAMPLE_SPACING_M = 5;
export const ROAD_LIFT_M = 0.4;
export const ROAD_MARKING_LIFT_M = 0.08;
export const ROAD_DASH_M = 4;
export const ROAD_GAP_M = 5;
export const ROAD_MARKING_WIDTH_M = 0.12;
export const GRID_SIZE_M = 500;
export const GRID_CELL_M = 5;
export const GRID_MAJOR_CELL_M = 50;
export const GRID_LIFT_M = 0.25;
export const GRID_FADE_DISTANCE_M = 100;
export const GRID_MINOR_OPACITY_RATIO = 0.18;
export const GRID_MAJOR_OPACITY_RATIO = 0.35;
export const HANDLE_LIFT_M = 2;
export const HANDLE_SIZE_PX = 16;
export const HANDLE_HOVER_SIZE_PX = 20;
export const HANDLE_INSERT_SIZE_PX = 10;
export const HANDLE_BORDER_PX = 2;
export const HANDLE_GLYPH_SIZE_PX = 6;
export const HANDLE_GLYPH_STROKE_PX = 1.5;
export const HANDLE_HIT_SIZE_PX = 32;
export const HANDLE_SEGMENTS_COUNT = 20;
export const HANDLE_LABEL_OFFSET_PX = -26;
export const HANDLE_CHIP_OFFSET_PX = 16;
export const XR_HANDLE_METRES_PER_PX = 0.001;
export const TRANSLATION_SNAP_M = 1;
export const ROTATION_SNAP_DEG = 15;
export const SCALE_SNAP_M = 0.5;
export const OVERLAY_RENDER_GROUP_ID = 2;
export const SELECTION_LINE_WIDTH_PX = 2;
export const HANDLE_RENDER_GROUP_ID = 3;
export const LABEL_FONT_SIZE_PX = 12;
export const LABEL_HEIGHT_PX = 30;
export const LABEL_WIDTH_PX = 260;
export const LABEL_RADIUS_PX = 6;
export const LABEL_LIFT_M = 16;
export const LABEL_PADDING_PX = 8;
export const MARKER_LIFT_M = 8;
export const LANDMARK_LIFT_M = 25;
export const LANDMARK_MAX_DISTANCE_M = 45_000;
export const LANDMARK_FADE_DISTANCE_M = 25_000;
export const LANDMARK_CLEARANCE_PX = 100;
export const MAX_VISIBLE_INCIDENT_MARKERS_COUNT = 50;
export const EXPOSURE_RING_SEGMENTS_COUNT = 128;
export const CHIP_FRACTION_DIGITS_COUNT = 1;
export const MATERIAL_TOKEN_NAMES = {
	concrete: "--muted-foreground",
	steel: "--chart-2",
	asphalt: "--foreground",
	earth: "--chart-5",
};
export const INCIDENT_TOKEN_NAMES = {
	critical: "--risk-critical",
	warning: "--risk-high",
	info: "--info",
};
export const INCIDENT_INK_TOKEN_NAMES = {
	critical: "--risk-critical-foreground",
	warning: "--risk-high-foreground",
	info: "--info-foreground",
};
