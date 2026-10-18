import { MeshBuilder, Vector3, type Mesh, type Scene } from '@babylonjs/core';
import { wallProfile, type Vec2, type WallCommand } from '../edit/commands';

/** How far the block extends below the ground so it never floats on slopes (m). */
const FOOTING = 1;
/** The terrain under the wall is raised to the same crest; lift the top so it does not z-fight. */
const TOP_CLEARANCE = 0.5;

/**
 * Concrete wall as a flat-shaded block along the polyline. It is drawn at the width the
 * solver uses (the crest of the applied profile), so the flow meets its visible faces; on
 * coarse grids that is wider than the real wall.
 */
export function concreteWallMesh(
  name: string,
  wall: Pick<WallCommand, 'points' | 'halfWidth' | 'height' | 'material'>,
  cellSize: number,
  groundAt: (x: number, z: number) => number,
  scene: Scene,
): Mesh {
  const { halfWidth, crest } = wallProfile(wall as WallCommand, cellSize);
  const half = halfWidth * crest;
  const pts: Vec2[] = wall.points.length === 1 ? [wall.points[0], [wall.points[0][0] + half, wall.points[0][1]]] : wall.points;

  // Densify so the top follows the ground, keeping each sample's direction for the offsets.
  const samples: { x: number; z: number; nx: number; nz: number }[] = [];
  const step = Math.max(cellSize, 1);
  for (let s = 0; s + 1 < pts.length; s++) {
    const [ax, az] = pts[s];
    const [bx, bz] = pts[s + 1];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    const count = Math.max(1, Math.ceil(len / step));
    for (let k = s === 0 ? 0 : 1; k <= count; k++) samples.push({ x: ax + ((bx - ax) * k) / count, z: az + ((bz - az) * k) / count, nx, nz });
  }
  // Average the normals at polyline joints so neighbouring segments share their corners.
  for (let k = 1; k + 1 < samples.length; k++) {
    const p = samples[k - 1];
    const q = samples[k + 1];
    const mx = p.nx + q.nx;
    const mz = p.nz + q.nz;
    const m = Math.hypot(mx, mz);
    if (m > 1e-3 && (p.nx !== q.nx || p.nz !== q.nz)) {
      samples[k].nx = mx / m;
      samples[k].nz = mz / m;
    }
  }

  const lb: Vector3[] = [];
  const lt: Vector3[] = [];
  const rt: Vector3[] = [];
  const rb: Vector3[] = [];
  for (const { x, z, nx, nz } of samples) {
    const ground = groundAt(x, z);
    const top = ground + wall.height + TOP_CLEARANCE;
    const bottom = ground - FOOTING;
    lb.push(new Vector3(x + nx * half, bottom, z + nz * half));
    lt.push(new Vector3(x + nx * half, top, z + nz * half));
    rt.push(new Vector3(x - nx * half, top, z - nz * half));
    rb.push(new Vector3(x - nx * half, bottom, z - nz * half));
  }
  // Collapse each path to the section centre at both ends to cap the block.
  const centre = (k: number) => {
    const c = lb[k].add(lt[k]).add(rt[k]).add(rb[k]).scale(0.25);
    return c;
  };
  const first = centre(0);
  const last = centre(lb.length - 1);
  const capped = (path: Vector3[]) => [first.clone(), ...path, last.clone()];
  const mesh = MeshBuilder.CreateRibbon(name, { pathArray: [lb, lt, rt, rb, lb].map(capped) }, scene);
  mesh.convertToFlatShadedMesh();
  mesh.isPickable = false;
  return mesh;
}
