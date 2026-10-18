import { describe, expect, it } from 'vitest';
import { vrStartPose, DoubleTap, DOUBLE_TAP_S, vrTiltAxis, gripStickMove, GRIP_TURN_RATE,
  clampAltitude, clampToBounds, deadZone, FLY, flySpeed, flyVelocity, gazeVelocity, ReliefSampler, SNAP_TURN, snapTurnStep,
} from '../../src/map/flight';
import { snapTurn } from '../../src/xr/placement';

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe('flySpeed', () => {
  it('is proportional to the height above ground, with a floor', () => {
    expect(flySpeed(100, false)).toBeCloseTo(100 * FLY.speedPerAgl);
    expect(flySpeed(200, false)).toBeCloseTo(2 * flySpeed(100, false));
    expect(flySpeed(0, false)).toBe(FLY.minSpeed);
    expect(flySpeed(-5, false)).toBe(FLY.minSpeed);
  });
  it('boost multiplies the speed', () => {
    expect(flySpeed(100, true)).toBeCloseTo(flySpeed(100, false) * FLY.boost);
  });
});

describe('flyVelocity', () => {
  const still = { forward: 0, strafe: 0, vertical: 0, boost: false };
  it('moves along the horizontal heading of the camera (yaw 0 looks +z)', () => {
    close(flyVelocity({ ...still, forward: 1 }, 0, 100), [0, 0, flySpeed(100, false)]);
    close(flyVelocity({ ...still, forward: 1 }, Math.PI / 2, 100), [flySpeed(100, false), 0, 0]);
    close(flyVelocity({ ...still, strafe: 1 }, 0, 100), [flySpeed(100, false), 0, 0]);
    close(flyVelocity({ ...still, forward: -1 }, 0, 100), [0, 0, -flySpeed(100, false)]);
  });
  it('Q/E move straight down/up', () => {
    close(flyVelocity({ ...still, vertical: 1 }, 1.2, 100), [0, flySpeed(100, false), 0]);
    close(flyVelocity({ ...still, vertical: -1 }, 1.2, 100), [0, -flySpeed(100, false), 0]);
  });
  it('diagonals are not faster; analog input below 1 is slower', () => {
    const v = flyVelocity({ ...still, forward: 1, strafe: 1 }, 0, 100);
    expect(Math.hypot(...v)).toBeCloseTo(flySpeed(100, false));
    expect(Math.hypot(...flyVelocity({ ...still, forward: 0.5 }, 0, 100))).toBeCloseTo(flySpeed(100, false) / 2);
  });
  it('applies boost and returns zero with no input', () => {
    close(flyVelocity({ ...still, forward: 1, boost: true }, 0, 100), [0, 0, flySpeed(100, true)]);
    close(flyVelocity(still, 0, 100), [0, 0, 0]);
  });
});

describe('gazeVelocity (Quest, one stick)', () => {
  const sp = flySpeed(100, false);
  it('stick forward follows the full 3D head gaze: looking up climbs, looking down descends', () => {
    const up = [0, Math.SQRT1_2, Math.SQRT1_2] as [number, number, number];
    close(gazeVelocity({ forward: 1, strafe: 0, boost: false }, up, 100), [0, sp * Math.SQRT1_2, sp * Math.SQRT1_2]);
    const down = [Math.SQRT1_2, -Math.SQRT1_2, 0] as [number, number, number];
    close(gazeVelocity({ forward: 1, strafe: 0, boost: false }, down, 100), [sp * Math.SQRT1_2, -sp * Math.SQRT1_2, 0]);
  });
  it('pulling back reverses along the gaze', () => {
    close(gazeVelocity({ forward: -1, strafe: 0, boost: false }, [0, 0.6, 0.8], 100), [0, -0.6 * sp, -0.8 * sp]);
  });
  it('stick X strafes horizontally, right of the head heading, even when looking down', () => {
    close(gazeVelocity({ forward: 0, strafe: 1, boost: false }, [0, -0.6, 0.8], 100), [sp, 0, 0]);
    close(gazeVelocity({ forward: 0, strafe: -1, boost: false }, [1, 0, 0], 100), [0, 0, sp]);
  });
  it('diagonals are not faster, no input is still, boost is optional', () => {
    expect(Math.hypot(...gazeVelocity({ forward: 1, strafe: 1, boost: false }, [0, 0, 1], 100))).toBeCloseTo(sp);
    close(gazeVelocity({ forward: 0, strafe: 0, boost: false }, [0, 0, 1], 100), [0, 0, 0]);
    expect(Math.hypot(...gazeVelocity({ forward: 1, strafe: 0, boost: true }, [0, 0, 1], 100))).toBeCloseTo(flySpeed(100, true));
  });
  it('looking straight down still strafes sideways without NaN', () => {
    const v = gazeVelocity({ forward: 0, strafe: 1, boost: false }, [0, -1, 0], 100);
    v.forEach((c) => expect(Number.isFinite(c)).toBe(true));
  });
});

describe('ReliefSampler', () => {
  // 2 × 2 vertices, x 0..10 east, z 0..-10 (row 1 is south), heights in km.
  const s = new ReliefSampler(new Float32Array([0, 1, 2, 4]), 2, 2, 0, 0, 10, -10);
  it('matches the mesh triangles (a,b,d) and (b,e,d) exactly', () => {
    expect(s.heightAt(0, 0)).toBeCloseTo(0);
    expect(s.heightAt(10, -10)).toBeCloseTo(4);
    // Upper-left triangle: a + fx (b - a) + fy (d - a).
    expect(s.heightAt(2, -3)).toBeCloseTo(0.2 + 0.6);
    // Lower-right triangle: e + (1 - fx)(d - e) + (1 - fy)(b - e).
    expect(s.heightAt(8, -7)).toBeCloseTo(4 + 0.2 * -2 + 0.3 * -3);
  });
  it('clamps outside the grid to its edge', () => {
    expect(s.heightAt(-50, 20)).toBeCloseTo(0);
    expect(s.heightAt(50, -50)).toBeCloseTo(4);
  });
});

describe('clampAltitude', () => {
  it('never lets the eye below ground × exaggeration + clearance', () => {
    expect(clampAltitude(1, 2, 15, 0.3, 1000)).toBeCloseTo(30.3);
    expect(clampAltitude(100, 2, 15, 0.3, 1000)).toBe(100);
    expect(clampAltitude(5, 2, 1, 0.3, 1000)).toBe(5);
  });
  it('caps the altitude', () => {
    expect(clampAltitude(5000, 2, 15, 0.3, 2500)).toBe(2500);
  });
});

describe('clampToBounds', () => {
  const b = { minX: -10, maxX: 10, minZ: -20, maxZ: 5 };
  it('keeps points inside and clamps outside ones', () => {
    expect(clampToBounds(3, 4, b)).toEqual([3, 4]);
    expect(clampToBounds(30, -40, b)).toEqual([10, -20]);
    expect(clampToBounds(-30, 40, b)).toEqual([-10, 5]);
  });
});

describe('deadZone', () => {
  it('zeroes small deflections and rescales the rest to [-1, 1]', () => {
    expect(deadZone(0.1, 0.15)).toBe(0);
    expect(deadZone(-0.14, 0.15)).toBe(0);
    expect(deadZone(1, 0.15)).toBeCloseTo(1);
    expect(deadZone(-1, 0.15)).toBeCloseTo(-1);
    expect(deadZone(0.575, 0.15)).toBeCloseTo(0.5);
  });
});

describe('snapTurnStep', () => {
  it('turns 30° once per flick and re-arms near the centre', () => {
    let st = { armed: true };
    const turns: number[] = [];
    for (const x of [0.2, 0.8, 0.9, 0.5, 0.8, 0.1, 0.8, 0, -0.9]) {
      const r = snapTurnStep(st, x);
      st = r.state;
      turns.push(r.turn);
    }
    expect(turns).toEqual([0, SNAP_TURN, 0, 0, 0, 0, SNAP_TURN, 0, -SNAP_TURN]);
    expect(SNAP_TURN).toBeCloseTo(Math.PI / 6);
  });
  it('the maquette snap-turn helper still turns about its centre by the given angle', () => {
    const pose = { center: [1, 2, 3] as [number, number, number], yaw: 0.5, scale: 2 };
    expect(snapTurn(pose, SNAP_TURN)).toEqual({ ...pose, yaw: 0.5 + Math.PI / 6 });
  });
});

describe('vrStartPose', () => {
  const bounds = { minX: -600, maxX: 800, minZ: -1000, maxZ: 1000 };
  it('starts over the middle of the map, facing north', () => {
    const pose = vrStartPose(bounds, 3);
    expect(pose.position[0]).toBe(100);
    expect(pose.position[2]).toBe(0);
    expect(pose.yaw).toBe(0);
  });
  it('starts a prudent margin above the highest exaggerated relief of Peru', () => {
    expect(vrStartPose(bounds, 3).position[1]).toBeCloseTo(FLY.peruTopKm * 3 + FLY.vrStartMargin);
    expect(vrStartPose(bounds, 10).position[1]).toBeCloseTo(FLY.peruTopKm * 10 + FLY.vrStartMargin);
  });
});

describe('gripStickMove (grip held + right stick: up/down and turn about the vertical)', () => {
  it('stick forward climbs and back descends at the altitude-proportional speed', () => {
    const up = gripStickMove({ x: 0, y: -1 }, 10, 0.5, false);
    expect(up.dy).toBeCloseTo(flySpeed(10, false) * 0.5);
    expect(up.yaw).toBe(0);
    expect(gripStickMove({ x: 0, y: 1 }, 10, 0.5, false).dy).toBeCloseTo(-flySpeed(10, false) * 0.5);
  });
  it('stick right turns right (positive yaw), left turns left, at GRIP_TURN_RATE', () => {
    expect(gripStickMove({ x: 1, y: 0 }, 10, 0.5, false).yaw).toBeCloseTo(GRIP_TURN_RATE * 0.5);
    expect(gripStickMove({ x: -1, y: 0 }, 10, 0.5, false).yaw).toBeCloseTo(-GRIP_TURN_RATE * 0.5);
  });
  it('ignores the dead zone', () => {
    expect(gripStickMove({ x: 0.1, y: 0.1 }, 10, 0.5, false)).toEqual({ dy: 0, yaw: 0 });
  });
});

describe('DoubleTap (double press of the grip → back to the start view)', () => {
  it('fires on a second press within the window, once', () => {
    const d = new DoubleTap();
    expect(d.press(10)).toBe(false);
    expect(d.press(10 + DOUBLE_TAP_S * 0.8)).toBe(true);
    expect(d.press(10 + DOUBLE_TAP_S * 1.2)).toBe(false);
  });
  it('does not fire when the presses are too far apart', () => {
    const d = new DoubleTap();
    d.press(0);
    expect(d.press(DOUBLE_TAP_S * 1.5)).toBe(false);
    expect(d.press(DOUBLE_TAP_S * 1.9)).toBe(true);
  });
});

describe('VR map tilt', () => {
  it('tilts about the horizontal axis to the right of the heading', () => {
    const [x, y, z] = vrTiltAxis(Math.PI / 2);
    expect(x).toBeCloseTo(0);
    expect(y).toBe(0);
    expect(z).toBeCloseTo(-1);
  });
  it('defaults to a moderate tilt', () => {
    expect(FLY.vrTiltDeg).toBeGreaterThan(0);
    expect(FLY.vrTiltDeg).toBeLessThanOrEqual(35);
  });
});
