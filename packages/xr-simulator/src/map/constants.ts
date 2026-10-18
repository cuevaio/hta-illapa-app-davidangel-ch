/** Overview fog (EXP2) per km of view distance near the ground: the Andes fade into haze. */
export const FOG_DENSITY_PER_KM = 0.00015;
/**
 * Most optical depth (view distance × density) the overview fog reaches at the point looked
 * at: beyond the distance where the near density gets there, the density falls with distance,
 * so a far view (all of Peru from above) stays clear: 1 − e^(−0.15²) ≈ 2 % fog.
 */
export const FOG_MAX_OPTICAL_DEPTH = 0.15;
/** Relative fog density change that re-uploads the relief look (avoids per-frame uniform churn). */
export const FOG_UPDATE_RATIO = 0.02;
