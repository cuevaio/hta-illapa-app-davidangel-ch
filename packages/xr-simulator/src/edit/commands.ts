/**
 * Serializable edit commands. The command list (not terrain snapshots) is the
 * source of truth: effective terrain = base terrain + active walls, in order.
 * The same list is what the scenario JSON stores (Phase 5).
 */
export type Vec2 = [number, number];

/**
 * Barrier type. Both are impermeable bed elevations for the solver; they differ in profile:
 * an earth berm (built with machinery) tapers smoothly, a concrete wall has near-vertical sides.
 */
export type WallMaterial = 'earth' | 'concrete';

/** Retaining wall along a polyline: one command per drag gesture. */
export interface WallCommand {
  type: 'wall';
  id: string;
  /** Polyline vertices in terrain-local metres (x, z); consecutive pairs are segments. */
  points: Vec2[];
  /** Real half thickness (m). Concrete walls thinner than a cell are widened when applied. */
  halfWidth: number;
  height: number;
  material: WallMaterial;
}

/** Fraction of the half width over which the crest is flat before tapering to the ground. */
export const WALL_CREST: Record<WallMaterial, number> = { earth: 0.7, concrete: 0.95 };

/**
 * Profile actually applied to the terrain. A grid cannot resolve a wall thinner than its
 * cells, so concrete walls are at least one cell of half width (two cells across).
 */
export function wallProfile(w: WallCommand, cellSize = 0): { halfWidth: number; crest: number } {
  const material = w.material ?? 'earth';
  return {
    halfWidth: material === 'concrete' ? Math.max(w.halfWidth, cellSize) : w.halfWidth,
    crest: WALL_CREST[material],
  };
}

/** Adds a debris-flow origin with its own hydrograph (sources accumulate; erase removes one). */
export interface SourceCommand {
  type: 'source';
  id: string;
  pos: Vec2;
  radius: number;
  peakDischarge: number;
  volume: number;
}

/** Removes an earlier wall or source. Undoing the erase brings it back. */
export interface EraseCommand {
  type: 'erase';
  id: string;
  target: string;
}

export type EditCommand = WallCommand | SourceCommand | EraseCommand;

export interface CommandHistory {
  commands: EditCommand[];
  /** Undone commands, most recent last. Cleared by any new command. */
  redo: EditCommand[];
}

export const EMPTY_HISTORY: CommandHistory = { commands: [], redo: [] };

let counter = 0;
export function newCommandId(prefix: string): string {
  counter++;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function push(h: CommandHistory, cmd: EditCommand): CommandHistory {
  return { commands: [...h.commands, cmd], redo: [] };
}

export function undo(h: CommandHistory): CommandHistory {
  if (h.commands.length === 0) return h;
  const last = h.commands[h.commands.length - 1];
  return { commands: h.commands.slice(0, -1), redo: [...h.redo, last] };
}

export function redo(h: CommandHistory): CommandHistory {
  if (h.redo.length === 0) return h;
  const next = h.redo[h.redo.length - 1];
  return { commands: [...h.commands, next], redo: h.redo.slice(0, -1) };
}

/** Walls not erased, in list order (the order edits are applied in). */
export function activeWalls(commands: EditCommand[]): WallCommand[] {
  const erased = new Set(commands.filter((c): c is EraseCommand => c.type === 'erase').map((c) => c.target));
  return commands.filter((c): c is WallCommand => c.type === 'wall' && !erased.has(c.id));
}

/** Sources not erased, in list order. Each one is an independent debris-flow origin. */
export function activeSources(commands: EditCommand[]): SourceCommand[] {
  const erased = new Set(commands.filter((c): c is EraseCommand => c.type === 'erase').map((c) => c.target));
  return commands.filter((c): c is SourceCommand => c.type === 'source' && !erased.has(c.id));
}

/** Axis-aligned bounds of the area a wall can modify: [minX, minZ, maxX, maxZ]. */
export function wallBounds(w: WallCommand, cellSize = 0): [number, number, number, number] {
  const hw = wallProfile(w, cellSize).halfWidth;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of w.points) {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  }
  return [minX - hw, minZ - hw, maxX + hw, maxZ + hw];
}

export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz;
  const t = len2 > 0 ? Math.min(Math.max(((px - ax) * vx + (pz - az) * vz) / len2, 0), 1) : 0;
  return Math.hypot(px - ax - t * vx, pz - az - t * vz);
}

export function distToPolyline(px: number, pz: number, pts: Vec2[]): number {
  if (pts.length === 1) return Math.hypot(px - pts[0][0], pz - pts[0][1]);
  let d = Infinity;
  for (let s = 0; s + 1 < pts.length; s++) d = Math.min(d, distToSegment(px, pz, pts[s][0], pts[s][1], pts[s + 1][0], pts[s + 1][1]));
  return d;
}

/** Topmost active wall whose applied footprint contains (x, z), or null. */
export function wallAt(commands: EditCommand[], x: number, z: number, cellSize = 0): WallCommand | null {
  const walls = activeWalls(commands);
  for (let k = walls.length - 1; k >= 0; k--) {
    if (distToPolyline(x, z, walls[k].points) <= wallProfile(walls[k], cellSize).halfWidth) return walls[k];
  }
  return null;
}

export function serializeCommands(commands: EditCommand[]): string {
  return JSON.stringify(commands);
}

export function parseCommands(json: string): EditCommand[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error('La lista de comandos debe ser un array');
  return data.map((c, k) => {
    const t = (c as { type?: unknown }).type;
    if (t !== 'wall' && t !== 'source' && t !== 'erase') throw new Error(`Comando ${k}: tipo desconocido ${String(t)}`);
    if (t === 'wall') return { material: 'earth', ...(c as object) } as WallCommand;
    return c as EditCommand;
  });
}

/** Erase target under (x, z): a source within its radius first, then the topmost wall. */
export function targetAt(commands: EditCommand[], x: number, z: number, cellSize = 0): SourceCommand | WallCommand | null {
  const sources = activeSources(commands);
  for (let k = sources.length - 1; k >= 0; k--) {
    const s = sources[k];
    if (Math.hypot(x - s.pos[0], z - s.pos[1]) <= Math.max(s.radius, cellSize)) return s;
  }
  return wallAt(commands, x, z, cellSize);
}
