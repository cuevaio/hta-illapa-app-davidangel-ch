/** VR point card (S13): distances from the head (m) and the card's pitch limits (rad). */
export const CARD_READING_DISTANCE_M = 0.75;
export const CARD_MIN_DISTANCE_M = 0.5;
/** Maquette: the card goes to the depth of the point on the table, up to this far. */
export const CARD_MAX_DISTANCE_M = 1.2;
/** Gap between the card's edge and the line of sight to the marked point (m). */
export const CARD_MARKER_GAP_M = 0.12;
/** The card follows the point's elevation within these limits, so it stays over the table. */
export const CARD_MIN_PITCH_RAD = (-20 * Math.PI) / 180;
export const CARD_MAX_PITCH_RAD = (15 * Math.PI) / 180;
/** VR controls instructions (S15): spawned once, this far away, turned right of the gaze (rad). */
export const INSTRUCTIONS_DISTANCE_M = 1.3;
export const INSTRUCTIONS_SIDE_ANGLE_RAD = (25 * Math.PI) / 180;
/** Its centre below eye level (m). */
export const INSTRUCTIONS_DROP_M = 0.15;
/** In the simulator the panel spawns in front (0.5 m wide at 0.6 m): the card goes further out. */
export const INSTRUCTIONS_BESIDE_PANEL_ANGLE_RAD = (40 * Math.PI) / 180;
/** Map credit (S16), maquette: gap past the table's near (south) edge, lift and tilt toward the user. */
export const CREDIT_TABLE_MARGIN_M = 0.03;
export const CREDIT_TABLE_LIFT_M = 0.02;
export const CREDIT_TABLE_TILT_RAD = (60 * Math.PI) / 180;
/** Its size follows the table between these factors of the fitted table. */
export const CREDIT_TABLE_MIN_SCALE = 0.6;
export const CREDIT_TABLE_MAX_SCALE = 2;
/** Flight: distance from the head and angle below the gaze heading (outside the central 30°). */
export const CREDIT_FLIGHT_DISTANCE_M = 1.1;
export const CREDIT_FLIGHT_PITCH_RAD = (28 * Math.PI) / 180;
/** It stays world-stable and is placed again once this far off the gaze, or this far from the head. */
export const CREDIT_FLIGHT_MAX_ANGLE_RAD = (50 * Math.PI) / 180;
export const CREDIT_FLIGHT_MAX_DISTANCE_M = 2.5;
