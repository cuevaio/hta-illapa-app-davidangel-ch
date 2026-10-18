import type { LandmarkLabelOffset, SettlementClusterConfig } from "./types";

export const QUEST_DEV_PORT = 5173;

export const BRAND_TEAL_COLOR = "#0B6E78";
export const BRAND_STARLIGHT_COLOR = "#8A6A1F";
export const TEXT_DARK_COLOR = "#0A2530";
export const TEXT_SECONDARY_COLOR = "#1E353E";
export const TEXT_MUTED_COLOR = "#4D6B74";
export const BACKGROUND_PAGE_COLOR = "#F2F7F8";
export const SURFACE_WHITE_COLOR = "#FFFFFF";
export const DIVIDER_LINE_COLOR = "#D5E1E4";
export const LOW_GREEN_COLOR = "#3E7D18";
export const MODERATE_YELLOW_COLOR = "#E8BC00";
export const HIGH_ORANGE_COLOR = "#D96200";
export const RISK_INK_DARK_COLOR = "#0A090B";
export const CRITICAL_RED_COLOR = "#C92A22";
export const TERRAIN_SAND_COLOR = "#D8CCA8";
export const NORMAL_ROAD_COLOR = "#1B333C";
export const BLACK_HEX_COLOR = "#000000";

export const HEMISPHERE_SKY_COLOR_HEX = 0xffffff;
export const HEMISPHERE_GROUND_COLOR_HEX = 0xcbbfa2;
export const HEMISPHERE_LIGHT_INTENSITY = 0.98;
export const SUN_LIGHT_COLOR_HEX = 0xfffcf5;
export const SUN_LIGHT_INTENSITY = 1.38;
export const SUN_LIGHT_X_M = 0.75;
export const SUN_LIGHT_Y_M = 1.65;
export const SUN_LIGHT_Z_M = 0.85;
export const FILL_LIGHT_COLOR_HEX = 0xdcebf0;
export const FILL_LIGHT_INTENSITY = 0.55;
export const FILL_LIGHT_X_M = -0.9;
export const FILL_LIGHT_Y_M = 0.8;
export const FILL_LIGHT_Z_M = -0.7;

export const CAMERA_FOV_DEG = 38;
export const CAMERA_NEAR_M = 0.04;
export const CAMERA_FAR_M = 20.0;
export const INITIAL_CAMERA_X_M = -0.05;
export const INITIAL_CAMERA_Y_M = 0.72;
export const INITIAL_CAMERA_Z_M = 0.98;
export const INITIAL_TARGET_X_M = 0;
export const INITIAL_TARGET_Y_M = 0.07;
export const INITIAL_TARGET_Z_M = 0.02;

export const ORBIT_DAMPING_FACTOR = 0.06;
export const ORBIT_MAX_POLAR_ANGLE_FACTOR = 0.47;
export const ORBIT_MIN_POLAR_ANGLE_RAD = 0.12;
export const ORBIT_MIN_DISTANCE_M = 0.25;
export const ORBIT_MAX_DISTANCE_M = 2.4;
export const MAX_DEVICE_PIXEL_RATIO = 2;
export const TONE_MAPPING_EXPOSURE = 1.04;

export const XR_TABLE_OFFSET_X_M = 0.0;
export const XR_TABLE_OFFSET_Y_M = -0.38;
export const XR_TABLE_OFFSET_Z_M = -0.85;
export const XR_RECENTER_DISTANCE_M = 0.85;
export const POINTER_RAY_LENGTH_M = 2.5;
export const CAMERA_LERP_FACTOR = 0.075;
export const CAMERA_ARRIVAL_THRESHOLD_M = 0.004;
export const POINTER_CLICK_DRAG_THRESHOLD_PX = 6;
export const OFFSCREEN_POINTER_COORD = -1000;
export const HAZARD_EMISSIVE_HIGHLIGHT_INTENSITY = 0.3;

export const PRESET_HAZARD_POS_X_M = -0.18;
export const PRESET_HAZARD_POS_Y_M = 0.4;
export const PRESET_HAZARD_POS_Z_M = 0.58;
export const PRESET_HAZARD_TARGET_X_M = -0.14;
export const PRESET_HAZARD_TARGET_Y_M = 0.13;
export const PRESET_HAZARD_TARGET_Z_M = 0.19;

export const PRESET_CHOSICA_POS_X_M = -0.36;
export const PRESET_CHOSICA_POS_Y_M = 0.34;
export const PRESET_CHOSICA_POS_Z_M = 0.6;
export const PRESET_CHOSICA_TARGET_X_M = -0.31;
export const PRESET_CHOSICA_TARGET_Y_M = 0.06;
export const PRESET_CHOSICA_TARGET_Z_M = 0.27;

export const PRESET_TICLIO_POS_X_M = -0.02;
export const PRESET_TICLIO_POS_Y_M = 0.44;
export const PRESET_TICLIO_POS_Z_M = 0.46;
export const PRESET_TICLIO_TARGET_X_M = -0.04;
export const PRESET_TICLIO_TARGET_Y_M = 0.18;
export const PRESET_TICLIO_TARGET_Z_M = 0.08;

export const PRESET_DETOUR_POS_X_M = -0.05;
export const PRESET_DETOUR_POS_Y_M = 0.64;
export const PRESET_DETOUR_POS_Z_M = 0.72;
export const PRESET_DETOUR_TARGET_X_M = -0.08;
export const PRESET_DETOUR_TARGET_Y_M = 0.12;
export const PRESET_DETOUR_TARGET_Z_M = -0.14;

export const TABLE_WIDTH_M = 1.2;
export const MIN_LON_DEG = -77.14;
export const MAX_LON_DEG = -75.12;
export const MIN_LAT_DEG = -12.22;
export const MAX_LAT_DEG = -10.72;
export const TABLE_DEPTH_M =
	TABLE_WIDTH_M * ((MAX_LAT_DEG - MIN_LAT_DEG) / (MAX_LON_DEG - MIN_LON_DEG));
export const TABLE_FRAME_PADDING_RATIO = 0.16;
export const TABLE_MIN_SPAN_DEG = 0.12;
export const EARTH_METERS_PER_DEGREE = 111_320;
export const TABLE_MIN_LONGITUDE_COSINE = 0.2;
export const TABLE_SELECTED_CAMERA_HEIGHT_FACTOR = 0.72;
export const TABLE_SELECTED_CAMERA_DISTANCE_FACTOR = 0.62;
export const PLACE_PIN_LABEL_OFFSET_M = 0.07;
export const TERRAIN_SKIRT_COLOR = "#B5A584";
export const MAX_ELEVATION_M = 4818;
export const MAX_TERRAIN_CLAMP_ELEVATION_M = 5250;
export const TABLE_MAX_HEIGHT_M = 0.168;
export const TABLE_BASE_HEIGHT_M = 0.022;
export const DELAYED_OFFSET_DISTANCE_M = 0.024;
export const SHARED_TRUNK_OFFSET_M = 0.011;
export const SHARED_TRUNK_LON_THRESHOLD_DEG = -75.96;
export const SHARED_TRUNK_BLEND_START_LON_DEG = -76.02;
export const SHARED_TRUNK_BLEND_END_LON_DEG = -75.9;
export const SHARED_TRUNK_BLEND_SCALE = 0.7;

export const RESAMPLED_PE22_INITIAL_STEPS_COUNT = 90;
export const RESAMPLED_PE22_HAZARD_STEPS_COUNT = 75;
export const RESAMPLED_PE22_TERMINAL_STEPS_COUNT = 140;
export const RESAMPLED_DETOUR_STEPS_COUNT = 220;
export const CURVE_TENSION_FACTOR = 0.35;
export const MIN_SEGMENT_LENGTH_SQ = 1e-10;
export const MIN_KILOMETER_SPAN_KM = 0.001;
export const PE22_CORRIDOR_WEIGHT = 1.0;
export const DETOUR_CORRIDOR_WEIGHT = 0.9;

export const CONTINENTAL_DIVIDE_BASE_LON_DEG = -76.22;
export const CONTINENTAL_DIVIDE_LAT_OFFSET_DEG = 11.6;
export const CONTINENTAL_DIVIDE_SLOPE_FACTOR = 0.32;
export const DEFAULT_MACRO_ELEVATION_M = 120;
export const MIN_WEST_SPAN_DEG = 0.1;
export const COASTAL_ASCENT_EXPONENT = 2.15;
export const COASTAL_BASE_ELEVATION_M = 80;
export const COASTAL_ASCENT_ELEVATION_GAIN_M = 4850;
export const EAST_PROGRESS_SPAN_DEG = 1.05;
export const MANTARO_BASIN_SOUTH_LAT_DEG = -12.15;
export const MANTARO_BASIN_NORTH_LAT_DEG = -11.45;
export const MANTARO_BASIN_LOW_ELEVATION_M = 3280;
export const MANTARO_BASIN_HIGH_ELEVATION_M = 4150;
export const CREST_DECAY_EXPONENT_FACTOR = 3.2;
export const CREST_PEAK_ELEVATION_M = 4920;

export const RIDGE_WAVE_A_LON_FREQ_A = 19.0;
export const RIDGE_WAVE_A_LAT_FREQ_A = 13.0;
export const RIDGE_WAVE_A_LON_FREQ_B = 11.0;
export const RIDGE_WAVE_A_LAT_FREQ_B = 17.0;
export const RIDGE_WAVE_B_LON_FREQ = 37.0;
export const RIDGE_WAVE_B_LAT_FREQ = 29.0;
export const RIDGE_WAVE_B_AMPLITUDE_FACTOR = 0.45;
export const ROUGHNESS_MIN_ELEVATION_M = 400;
export const ROUGHNESS_MAX_ELEVATION_M = 3200;
export const RIDGE_WAVE_A_HEIGHT_M = 340;
export const RIDGE_WAVE_B_HEIGHT_M = 180;

export const OCEAN_COAST_BASE_LON_DEG = -77.04;
export const OCEAN_COAST_LAT_OFFSET_DEG = 12.04;
export const OCEAN_COAST_SLOPE_FACTOR = 0.42;
export const OCEAN_TRANSITION_WIDTH_DEG = 0.08;
export const OCEAN_FLOOR_ELEVATION_M = 10;

export const VALLEY_CARVE_RADIUS_DEG = 0.095;
export const CANYON_WALL_BUMP_HEIGHT_M = 290;
export const SMOOTHSTEP_CUBIC_COEFF_A = 3;
export const SMOOTHSTEP_CUBIC_COEFF_B = 2;

export const TERRAIN_SEGMENTS_X_COUNT = 180;
export const TERRAIN_SEGMENTS_Z_COUNT = 132;
export const TERRAIN_TEX_WIDTH_PX = 2048;
export const TERRAIN_TEX_HEIGHT_PX = 1480;
export const BASE_PLINTH_HEIGHT_M = 0.018;
export const BASE_PLINTH_PADDING_M = 0.018;
export const DRAFTING_MAT_MARGIN_M = 0.095;
export const DRAFTING_MAT_SURFACE_OFFSET_M = 0.001;
export const DRAFTING_MAT_TEX_WIDTH_PX = 2048;
export const DRAFTING_MAT_INNER_BORDER_INSET_PX = 18;
export const DRAFTING_MAT_OUTER_BORDER_INSET_PX = 24;
export const DRAFTING_MAT_SCALE_BAR_WIDTH_PX = 280;

export const NORMAL_ROAD_WIDTH_M = 0.0085;
export const HAZARD_ROAD_WIDTH_M = 0.0145;
export const DELAYED_ROAD_WIDTH_M = 0.0125;
export const DETOUR_ROAD_WIDTH_M = 0.01;
export const NORMAL_ROAD_LIFT_M = 0.0038;
export const HAZARD_ROAD_LIFT_M = 0.0068;
export const DELAYED_ROAD_LIFT_M = 0.0062;
export const DETOUR_ROAD_LIFT_M = 0.0045;
export const RIBBON_SKIRT_DEPTH_M = 0.005;
export const RIBBON_UV_REPEAT_PER_METER = 26;
export const FLOW_RIBBON_TEX_WIDTH_PX = 256;
export const FLOW_RIBBON_TEX_HEIGHT_PX = 64;
export const FLOW_RIBBON_BORDER_PX = 7;
export const FLOW_RIBBON_STRIPE_STEP_PX = 64;

export const CARD_WIDTH_M = 0.35;
export const CARD_HEIGHT_M = 0.205;
export const CARD_FLOAT_Y_OFFSET_M = 0.178;
export const CARD_CANVAS_WIDTH_PX = 1280;
export const CARD_CANVAS_HEIGHT_PX = 748;
export const CARD_TILT_ANGLE_RAD = -0.15;
export const CARD_HIGHLIGHT_SCALE_FACTOR = 1.07;
export const CARD_RING_INNER_RADIUS_M = 0.013;
export const CARD_RING_OUTER_RADIUS_M = 0.02;
export const CARD_RING_SEGMENTS_COUNT = 32;
export const CARD_RING_Y_OFFSET_M = 0.0075;
export const CARD_STEM_TOP_OVERLAP_M = 0.006;

export const BILLBOARD_PIXEL_SCALE = 3;
export const BILLBOARD_WORLD_METER_PER_PX = 0.0005;
export const BILLBOARD_PADDING_X_PX = 24;
export const BILLBOARD_PADDING_Y_PX = 12;
export const BILLBOARD_MARGIN_PX = 4;
export const BILLBOARD_CORNER_RADIUS_PX = 10;
export const BILLBOARD_BORDER_WIDTH_PX = 2.5;
export const DEFAULT_BILLBOARD_FONT_SIZE_PX = 24;
export const DEFAULT_PIN_FONT_SIZE_PX = 22;
export const HAZARD_LABEL_FONT_SIZE_PX = 21;
export const DETOUR_LABEL_FONT_SIZE_PX = 20;

export const CALLOUT_DOT_RADIUS_M = 0.0045;
export const CALLOUT_DOT_HEIGHT_M = 0.003;
export const CALLOUT_DOT_SEGMENTS_COUNT = 16;
export const CALLOUT_DOT_Y_OFFSET_M = 0.0055;
export const CALLOUT_ELBOW_DROP_M = 0.01;
export const CALLOUT_LINE_START_Y_OFFSET_M = 0.006;
export const CALLOUT_LINE_END_DROP_M = 0.008;

export const RAIN_STREAK_COUNT = 84;
export const RAIN_BAND_HEIGHT_M = 0.075;
export const RAIN_SPREAD_M = 0.042;
export const RAIN_MIN_Y_OFFSET_M = 0.012;
export const RAIN_MIN_STREAK_LENGTH_M = 0.012;
export const RAIN_VARIATION_STREAK_LENGTH_M = 0.008;
export const RAIN_SLANT_X_M = 0.0025;
export const RAIN_FALL_SPEED_FACTOR = 0.85;
export const CLOUD_PUFF_WIDTH_M = 0.036;
export const CLOUD_PUFF_HEIGHT_M = 0.008;
export const CLOUD_PUFF_DEPTH_M = 0.022;
export const CLOUD_Y_OFFSET_ABOVE_RAIN_M = 0.016;
export const CLOUD_SEGMENT_RATIOS = [0.25, 0.5, 0.75] as const;

export const RNG_DEFAULT_SEED = 1337;
export const RNG_SETTLEMENT_SEED = 2026;
export const RNG_RAIN_SEED = 909;
export const LCG_MULTIPLIER = 1664525;
export const LCG_INCREMENT = 1013904223;
export const LCG_MODULUS = 4294967296;

export const TOPO_SHORE_ELEVATION_M = 28;
export const TOPO_CONTOUR_MIN_ELEVATION_M = 90;
export const TOPO_MAJOR_CONTOUR_INTERVAL_M = 800;
export const TOPO_MINOR_CONTOUR_INTERVAL_M = 200;
export const TOPO_MAJOR_CONTOUR_BAND_M = 22;
export const TOPO_MINOR_CONTOUR_BAND_M = 14;
export const TOPO_HUAROCHIRI_START_KM = 68;
export const TOPO_HUAROCHIRI_END_KM = 116;
export const TOPO_GRID_COLUMNS_COUNT = 12;
export const TOPO_GRID_ROWS_COUNT = 8;
export const QUEBRADA_KILOMETER_MARKS = [42, 54, 63, 74, 83, 94, 106] as const;
export const TREE_CLUSTER_KILOMETER_MARKS = [
	32, 40, 48, 65, 76, 86, 225, 245, 275, 295,
] as const;
export const TREES_PER_CLUSTER_COUNT = 7;

export const SENAMHI_STATION_KM = 89;
export const SENAMHI_LATERAL_OFFSET_M = 0.022;
export const TICLIO_ARCH_KM = 132;
export const PARALLEL_BRIDGE_STEPS_COUNT = 10;
export const PARALLEL_BRIDGE_Y_OFFSET_M = 0.0055;

export const HAZARD_FLOW_SPEED = 0.45;
export const DELAYED_FLOW_SPEED = 0.32;
export const DETOUR_FLOW_SPEED = 0.28;
export const RING_PULSE_FREQUENCY_RAD_S = 3.5;
export const RING_PULSE_AMPLITUDE = 0.14;
export const RADAR_PULSE_FREQUENCY_RAD_S = 5.0;
export const RADAR_PULSE_AMPLITUDE = 0.12;

export const CARRIER_PROFILES: Record<string, string> = {
	scania:
		"Elegible en PE-22 y en Desvío SUTRAN Ruta 3 (máx. 5 ejes · 43 t). Recomendación: Retrasar 18 h.",
	volvo:
		"Excede el límite de 5 ejes en Ruta 3 (T3S3 · 6 ejes · 48 t). Única vía directa: PE-22 retrasando 18 h.",
	hino: "Camión C3 (3 ejes · 25 t) elegible en PE-22 y en las 5 rutas alternas SUTRAN. Recomendación: Retrasar 18 h.",
};

export const CARRIER_KEYS_ORDER = ["scania", "volvo", "hino"] as const;

export const SETTLEMENT_CLUSTERS: readonly SettlementClusterConfig[] = [
	{
		kilometerMark: 2,
		houseCount: 28,
		spreadRadiusMeters: 0.038,
		isCoastalZone: true,
	},
	{
		kilometerMark: 14,
		houseCount: 14,
		spreadRadiusMeters: 0.024,
		isCoastalZone: true,
	},
	{
		kilometerMark: 38,
		houseCount: 24,
		spreadRadiusMeters: 0.025,
		isCoastalZone: false,
	},
	{
		kilometerMark: 58,
		houseCount: 12,
		spreadRadiusMeters: 0.018,
		isCoastalZone: false,
	},
	{
		kilometerMark: 75,
		houseCount: 22,
		spreadRadiusMeters: 0.022,
		isCoastalZone: false,
	},
	{
		kilometerMark: 96,
		houseCount: 14,
		spreadRadiusMeters: 0.018,
		isCoastalZone: false,
	},
	{
		kilometerMark: 112,
		houseCount: 10,
		spreadRadiusMeters: 0.015,
		isCoastalZone: false,
	},
	{
		kilometerMark: 175,
		houseCount: 18,
		spreadRadiusMeters: 0.024,
		isCoastalZone: false,
	},
	{
		kilometerMark: 235,
		houseCount: 16,
		spreadRadiusMeters: 0.024,
		isCoastalZone: false,
	},
	{
		kilometerMark: 301,
		houseCount: 32,
		spreadRadiusMeters: 0.035,
		isCoastalZone: false,
	},
] as const;

export const LANDMARK_OFFSETS: Record<string, LandmarkLabelOffset> = {
	Lima: { offsetX: -0.025, offsetY: 0.048, offsetZ: 0.038 },
	Chosica: { offsetX: -0.028, offsetY: 0.052, offsetZ: -0.048 },
	Huarochirí: { offsetX: -0.06, offsetY: 0.042, offsetZ: 0.072 },
	Ticlio: { offsetX: 0.018, offsetY: 0.064, offsetZ: -0.038 },
	Huancayo: { offsetX: 0.028, offsetY: 0.05, offsetZ: 0.032 },
};

export const DEFAULT_LANDMARK_OFFSET: LandmarkLabelOffset = {
	offsetX: 0,
	offsetY: 0.045,
	offsetZ: 0,
};
