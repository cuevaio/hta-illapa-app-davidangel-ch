export const CONTOUR_DEFAULT_SEED = 17;
export const CONTOUR_WIDTH_PX = 1600;
export const CONTOUR_HEIGHT_PX = 900;
export const CONTOUR_STROKE_WIDTH_PX = 1;
export const CONTOUR_NOISE_GRID_SIZE = 64;
export const CONTOUR_RANDOM_MULTIPLIER = 1664525;
export const CONTOUR_RANDOM_INCREMENT = 1013904223;
export const CONTOUR_RANDOM_RANGE = 4294967296;
export const CONTOUR_SMOOTHSTEP_LINEAR = 3;
export const CONTOUR_SMOOTHSTEP_QUADRATIC = 2;

export const TOPO_CELL_SIZE_PX = 16;
export const TOPO_LEVEL_COUNT = 14;
export const TOPO_LEVEL_MARGIN = 0.06;
export const TOPO_NOISE_SCALE_PX = 250;
export const TOPO_DETAIL_SCALE_PX = 100;
export const TOPO_DETAIL_WEIGHT = 0.28;
export const TOPO_WARP_SCALE_PX = 400;
export const TOPO_WARP_AMOUNT_PX = 160;
export const TOPO_WARP_OFFSET = 23;
export const TOPO_EDGE_ORIENTATION_COUNT = 2;
export const TOPO_SADDLE_EDGE_COUNT = 4;
export const TOPO_SEGMENT_ENDPOINT_COUNT = 2;
export const TOPO_CELL_EDGES = [
	{ startColumn: 0, startRow: 0, endColumn: 1, endRow: 0, orientation: 0 },
	{ startColumn: 1, startRow: 0, endColumn: 1, endRow: 1, orientation: 1 },
	{ startColumn: 0, startRow: 1, endColumn: 1, endRow: 1, orientation: 0 },
	{ startColumn: 0, startRow: 0, endColumn: 0, endRow: 1, orientation: 1 },
];

export const MAYU_DEFAULT_SEED = 29;
export const MAYU_WIDTH_PX = 1600;
export const MAYU_HEIGHT_PX = 900;
export const MAYU_COORDINATE_PRECISION = 2;
export const MAYU_CURVE_START_PX = { horizontal: -80, vertical: 765 };
export const MAYU_CURVE_CONTROL_START_PX = { horizontal: 480, vertical: 855 };
export const MAYU_CURVE_CONTROL_END_PX = { horizontal: 1040, vertical: 90 };
export const MAYU_CURVE_END_PX = { horizontal: 1680, vertical: 135 };
export const MAYU_BEZIER_DEGREE = 3;
export const MAYU_STAR_COUNT = 220;
export const MAYU_STAR_RADIUS_MIN_PX = 0.7;
export const MAYU_STAR_RADIUS_RANGE_PX = 1.5;
export const MAYU_STAR_OPACITY_MIN = 0.2;
export const MAYU_STAR_OPACITY_RANGE = 0.65;
export const MAYU_STAR_HORIZONTAL_SPREAD_PX = 90;
export const MAYU_STAR_VERTICAL_SPREAD_PX = 180;
export const MAYU_DISTRIBUTION_CENTER = 1.5;
export const MAYU_GLOW_WIDTH_PX = 120;
export const MAYU_GLOW_BLUR_PX = 35;
export const MAYU_GLOW_OPACITY = 0.16;
export const MAYU_GLOW_FILTER_BOUNDS = { start: "-50%", extent: "200%" };
export const MAYU_RAIN_COUNT = 64;
export const MAYU_RAIN_LENGTH_MIN_PX = 14;
export const MAYU_RAIN_LENGTH_RANGE_PX = 30;
export const MAYU_RAIN_HORIZONTAL_SLOPE = -0.45;
export const MAYU_RAIN_OPACITY_MIN = 0.12;
export const MAYU_RAIN_OPACITY_STEP = 0.1;
export const MAYU_RAIN_OPACITY_GROUP_COUNT = 4;
export const MAYU_RAIN_STROKE_WIDTH_PX = 1;

export const STRUCTURE_ART_VIEWBOX_PX = "0 0 128 128";
export const STRUCTURE_ART_STROKE_WIDTH_PX = 1.4;
export const STRUCTURE_ART_PRIMITIVE_STROKE_WIDTH_PX = 2.2;
