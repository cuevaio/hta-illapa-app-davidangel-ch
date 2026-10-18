import type { DeviceClass } from './device';

export type QualityProfileId = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  id: QualityProfileId;
  /** Solver grid resolution (cells per side). */
  solverResolution: 128 | 192 | 256 | 512;
  /** Render mesh subdivisions per side for terrain and flow surfaces. */
  renderSubdivisions: number;
  /** Frame-rate target used by the automatic degradation governor. */
  targetFps: number;
}

export const QUALITY_PROFILES: Record<QualityProfileId, QualityProfile> = {
  low: { id: 'low', solverResolution: 128, renderSubdivisions: 127, targetFps: 60 },
  medium: { id: 'medium', solverResolution: 192, renderSubdivisions: 191, targetFps: 60 },
  high: { id: 'high', solverResolution: 256, renderSubdivisions: 255, targetFps: 60 },
  ultra: { id: 'ultra', solverResolution: 512, renderSubdivisions: 511, targetFps: 60 },
};

export const QUALITY_ORDER: QualityProfileId[] = ['low', 'medium', 'high', 'ultra'];

/** Frame-rate target for an immersive session on Meta Quest. */
export const QUEST_TARGET_FPS = 72;

export interface QualityInputs {
  device: DeviceClass;
  hasWebGPU: boolean;
  /** `maxStorageBufferBindingSize` of the adapter, in bytes, if known. */
  maxStorageBufferBindingSize?: number;
}

/**
 * Default profile per device. `ultra` is never a default: it is opt-in because
 * 512² cells costs ~4x the `high` step time.
 */
export function pickDefaultProfile({ device, hasWebGPU, maxStorageBufferBindingSize }: QualityInputs): QualityProfile {
  if (!hasWebGPU) return QUALITY_PROFILES.low;
  let id: QualityProfileId;
  switch (device) {
    case 'desktop':
      id = 'high';
      break;
    case 'quest':
    case 'tablet':
      id = 'medium';
      break;
    case 'mobile':
      id = 'low';
      break;
  }
  // Each solver buffer holds 4 floats per cell; refuse profiles the adapter cannot bind.
  if (maxStorageBufferBindingSize !== undefined) {
    while (id !== 'low' && cellBufferBytes(QUALITY_PROFILES[id].solverResolution) > maxStorageBufferBindingSize) {
      id = QUALITY_ORDER[QUALITY_ORDER.indexOf(id) - 1];
    }
  }
  const profile = QUALITY_PROFILES[id];
  return device === 'quest' ? { ...profile, targetFps: QUEST_TARGET_FPS } : profile;
}

export function cellBufferBytes(resolution: number): number {
  return resolution * resolution * 4 * Float32Array.BYTES_PER_ELEMENT;
}
