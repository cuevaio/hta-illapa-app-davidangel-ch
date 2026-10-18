import { describe, expect, it } from 'vitest';
import type * as Internal from '../../src/viewer/api';
import type * as Public from '../../src/viewer/api.public';

type Assignable<From, To> = [From] extends [To] ? true : false;

// Checked by `tsc` over the tests: host apps type-check against api.public.d.ts only, so it must
// keep describing the sources (a mismatch turns one of these into `false` and fails check-types).
const contract = {
  createXrViewer: true satisfies Assignable<typeof Internal.createXrViewer, typeof Public.createXrViewer>,
  hostSeenByModes: true satisfies Assignable<Internal.ModeHost, Public.ModeHost>,
  hostModesAccepted: true satisfies Assignable<Public.SimulatorModeFactory, Internal.SimulatorModeFactory>,
  siteTerrain: true satisfies Assignable<Internal.SiteTerrain, Public.SiteTerrain>,
  attribution: true satisfies Assignable<typeof Internal.TERRAIN_ATTRIBUTION, typeof Public.TERRAIN_ATTRIBUTION>,
};

describe('viewer public API', () => {
  it('matches the sources it declares', () => {
    expect(Object.values(contract).every(Boolean)).toBe(true);
  });
});
