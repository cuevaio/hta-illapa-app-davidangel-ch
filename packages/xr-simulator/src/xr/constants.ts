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
