export const GRID_SIZE_M = 500;
export const GRID_CELL_M = 5;
export const GRID_LIFT_M = 0.25;
export const FULL_TURN_RAD = Math.PI * 2;
export const CAMERA_INITIAL_EAST_M = 1800;
export const CAMERA_INITIAL_HEIGHT_M = 1500;
export const CAMERA_INITIAL_SOUTH_M = 1800;
export const CAMERA_MIN_DISTANCE_M = 50;
export const CAMERA_MAX_DISTANCE_M = 30000;
export const CAMERA_NEAR_M = 0.5;
export const CAMERA_FAR_M = 60000;
export const CAMERA_FIELD_OF_VIEW_DEG = 45;
export const CAMERA_MAX_POLAR_RAD = Math.PI / 2 - 0.05;
export const CAMERA_DAMPING_RATIO = 0.12;
export const CAMERA_GROUND_CLEARANCE_M = 15;
export const CAMERA_FOCUS_DURATION_MS = 800;
export const CAMERA_FOCUS_EASE_EXPONENT = 3;
export const DPR_MAX_RATIO = 2;
export const SUN_POSITION_M: [number, number, number] = [3000, 8000, 4000];
export const SUN_INTENSITY_RATIO = 2;
export const SKY_INTENSITY_RATIO = 2;
export const DECK_THICKNESS_M = 1.5;
export const ABUTMENT_DEPTH_M = 3;
export const PIER_WIDTH_M = 1.4;
export const RAIL_HEIGHT_M = 1.2;
export const RAIL_WIDTH_PX = 1.5;
export const TUNNEL_LINING_M = 0.6;
export const TUNNEL_ARC_SEGMENTS_COUNT = 24;
export const TUNNEL_TERRAIN_OPACITY_RATIO = 0.35;
export const ROAD_SAMPLE_SPACING_M = 5;
export const ROAD_LIFT_M = 0.4;
export const ROAD_MARKING_LIFT_M = 0.08;
export const ROAD_DASH_M = 4;
export const ROAD_DASH_GAP_M = 5;
export const ROAD_MARKING_WIDTH_PX = 1;
export const HANDLE_LIFT_M = 2;
export const SPHERE_SEGMENTS_COUNT = 12;
export const COLUMN_SEGMENTS_COUNT = 20;
export const TRANSLATION_SNAP_M = 1;
export const ROTATION_SNAP_DEG = 15;
export const SCALE_SNAP_M = 0.5;
export const MATERIAL_ROUGHNESS_RATIO = 0.85;
export const STEEL_METALNESS_RATIO = 0.6;
export const SELECTION_LINE_WIDTH_PX = 2;
export const MARKER_LIFT_M = 8;

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
export const TUNNEL_ARCH_WALL_RATIO = 0.5;
export const TUNNEL_PORTAL_DEPTH_M = 1;
export const MIN_GEOMETRY_LENGTH_M = 0.01;
export const INITIAL_TERRAIN_ELEVATION_M = 2500;
export const TERRAIN_REFRESH_INTERVAL_MS = 250;
export const TERRAIN_LOAD_TIMEOUT_MS = 30000;
export const PLACEMENT_CLICK_THRESHOLD_PX = 4;
export const GHOST_PREVIEW_OPACITY_RATIO = 0.35;
export const HANDLE_SIZE_PX = 16;
export const HANDLE_HOVER_SIZE_PX = 20;
export const HANDLE_HIT_SIZE_PX = 32;
export const MIDPOINT_HANDLE_SIZE_PX = 10;
export const HANDLE_CHIP_OFFSET_PX = 16;
export const GRID_MAJOR_CELL_M = 50;
export const GRID_MAJOR_OPACITY_RATIO = 0.35;
export const GRID_FADE_DISTANCE_M = 100;
export const GRID_MINOR_OPACITY_RATIO = 0.18;
export const EXPOSURE_RING_SEGMENTS_COUNT = 128;
export const EXPOSURE_RING_DASH_M = 50;
export const EXPOSURE_RING_GAP_M = 30;
export const CHIP_MAXIMUM_FRACTION_DIGITS_COUNT = 1;
export const LANDMARK_MAX_DISTANCE_M = 45000;
export const LANDMARK_FADE_START_DISTANCE_M = 25000;
export const LANDMARK_STRUCTURE_CLEARANCE_PX = 100;
export const LANDMARK_LIFT_M = 25;
export const STRUCTURE_LABEL_LIFT_M = 16;
export const HOVER_OUTLINE_OPACITY_RATIO = 0.5;

export const INCIDENT_INK_TOKEN_NAMES = {
	critical: "--risk-critical-foreground",
	warning: "--risk-high-foreground",
	info: "--info-foreground",
};
export const HANDLE_HOVER_LEAVE_DELAY_MS = 150;

export const DRAG_CLICK_SUPPRESSION_MS = 100;
export const CAMERA_FOCUS_FILL_RATIO = 0.45;
export const CAMERA_OVERVIEW_FILL_RATIO = 0.75;
export const CAMERA_FOCUS_MIN_DISTANCE_M = 150;
export const CAMERA_FOCUS_ELEVATION_RATIO = 0.7;
export const CAMERA_FRAMING_ITERATIONS_COUNT = 24;
export const CAMERA_FRAME_PRIORITY = -0.5;
export const CAMERA_FOCUSED_FAR_M = 10000;
export const STRUCTURE_LABEL_Z_INDEX = 10;
export const SELECTED_STRUCTURE_LABEL_Z_INDEX = 15;
export const INCIDENT_LABEL_Z_INDEX = 20;
export const CAMERA_NEAR_DISTANCE_RATIO = 0.001;
export const CAMERA_FAR_DISTANCE_RATIO = 2;
export const CURSOR_REPORT_INTERVAL_MS = 100;
export const CURSOR_CHANGE_EPSILON_M = 0.05;
export const GRID_REFRESH_INTERVAL_MS = 500;
export const GRID_FOLLOW_STEP_M = 50;
export const XR_CLICK_MOVEMENT_M = 0.03;
export const XR_HANDLE_METRES_PER_PX = 0.001;
export const HANDLE_RENDER_ORDER = 10000;
export const HANDLE_STEM_WIDTH_PX = 1;
export const HANDLE_CHIP_FONT_SIZE_PX = 12;
export const HANDLE_CHIP_WIDTH_PX = 500;
export const HANDLE_DELETE_RADIUS_PX = 12;
export const LANDMARK_Z_INDEX = 1;
export const MAX_VISIBLE_INCIDENT_MARKERS_COUNT = 50;
export const TERRAIN_HEIGHT_CHANGE_EPSILON_M = 0.05;
export const GRID_HEIGHT_PROBE_CELLS_COUNT = 4;
export const TERRAIN_REVISION_SAMPLE_SPACING_M = 100;
export const OUTLINE_RENDER_ORDER = 1000;
