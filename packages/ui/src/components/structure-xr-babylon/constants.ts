export const MAQUETA_SCALE_RATIO = 1 / 1000;
export const MAQUETA_SIZE_M = 1000;
export const PLACEMENT_FALLBACK_DELAY_MS = 3000;
export const PLACEMENT_FALLBACK_DISTANCE_M = 1.2;
export const PLACEMENT_FALLBACK_HEIGHT_M = 0.75;
export const SUPPORT_RECHECK_INTERVAL_MS = 500;
export const SUPPORT_RECHECK_MAX_ATTEMPTS_COUNT = 20;
export const SURFACE_MIN_UP_DOT_RATIO = 0.98;
export const RETICLE_DIAMETER_M = 0.1;
export const RETICLE_THICKNESS_M = 0.01;
export const RETICLE_SEGMENTS_COUNT = 48;
export const RETICLE_SURFACE_OFFSET_M = 0.002;
export const HINT_DISTANCE_M = 0.65;
export const HINT_VERTICAL_OFFSET_M = -0.14;
/** The placement hint card, in web CSS px (the xr-simulator VR scale turns them into metres). */
export const HINT_CSS_PX = { width: 368, height: 96 } as const;
export const PANEL_OFFSET_X_M = 0.68;
export const PANEL_OFFSET_Y_M = 0.18;
/** Panel buttons are Mayu `lg` buttons this wide (web CSS px). */
export const PANEL_BUTTON_WIDTH_CSS_PX = 224;
export const PANEL_BUTTON_DEPTH_M = 0.012;
export const PANEL_FIRST_BUTTON_OFFSET_RATIO = 0.5;
export const PANEL_LABEL_OFFSET_M = 0.007;
export const XR_CAMERA_NEAR_M = 0.01;
export const XR_CAMERA_FAR_M = 20;
export const DEFAULT_RING_COLOR = "#0b6e78";
