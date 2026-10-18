import { activeSources, type EditCommand } from '../edit/commands';
import { triangularHydrograph } from '../solver/params';
import type { HydrographPoint, MaterialParams, RheologyModel } from '../solver/Solver';
import type { PngDemOptions } from './dem';
import type { HeightGrid } from './terrain';

/**
 * Serializable scenario: everything needed to rerun a simulation elsewhere (another browser,
 * a remote solver, the frame player). Terrain-local metres: x = grid column, z = grid row.
 */
export const SCENARIO_FORMAT = 'huaico-scenario';
export const SCENARIO_VERSION = 1;

export type ScenarioTerrain =
  /** The built-in synthetic ravine. */
  | { kind: 'synthetic'; size_m: number }
  /** A DEM file referenced by URI (relative to the scenario or absolute). */
  | { kind: 'dem-ref'; uri: string; format: 'geotiff' | 'png16'; png?: PngDemOptions; label?: string }
  /** A DEM embedded as row-major float32 heights (index = j·n + i), base64-encoded. */
  | { kind: 'dem-inline'; resolution: number; cellSize: number; encoding: 'float32-base64'; data: string; label?: string };

export interface ScenarioOrigin {
  id: string;
  pos: [number, number];
  radius: number;
  volume: number;
  peakDischarge: number;
  /** Discharge (m³/s) over time since the origin starts; derived from volume and peak. */
  hydrograph: HydrographPoint[];
}

export interface Scenario {
  format: typeof SCENARIO_FORMAT;
  version: typeof SCENARIO_VERSION;
  name: string;
  terrain: ScenarioTerrain;
  material: MaterialParams;
  /** Active origins (informative, for consumers that do not replay commands); all start at t = 0. */
  origins: ScenarioOrigin[];
  /** Edit history in order: origins, walls and erasures. Replaying it rebuilds the edited terrain. */
  commands: EditCommand[];
  simulation: { speed: number };
}

export function buildScenario(p: { name: string; terrain: ScenarioTerrain; material: MaterialParams; commands: EditCommand[]; speed: number }): Scenario {
  return {
    format: SCENARIO_FORMAT,
    version: SCENARIO_VERSION,
    name: p.name,
    terrain: p.terrain,
    material: { ...p.material },
    origins: activeSources(p.commands).map((c) => ({
      id: c.id, pos: c.pos, radius: c.radius, volume: c.volume, peakDischarge: c.peakDischarge,
      hydrograph: triangularHydrograph(c.volume, c.peakDischarge),
    })),
    commands: p.commands,
    simulation: { speed: p.speed },
  };
}

export function serializeScenario(s: Scenario): string {
  return JSON.stringify(s, null, 2);
}

export function encodeInlineTerrain(grid: HeightGrid, label?: string): ScenarioTerrain {
  const bytes = new Uint8Array(grid.heights.buffer, grid.heights.byteOffset, grid.heights.byteLength);
  let bin = '';
  for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return { kind: 'dem-inline', resolution: grid.resolution, cellSize: grid.cellSize, encoding: 'float32-base64', data: btoa(bin), ...(label ? { label } : {}) };
}

export function decodeInlineTerrain(t: Extract<ScenarioTerrain, { kind: 'dem-inline' }>): HeightGrid {
  const bin = atob(t.data);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  if (bytes.length !== t.resolution * t.resolution * 4) throw new Error(`terreno: se esperaban ${t.resolution}² alturas`);
  return { resolution: t.resolution, cellSize: t.cellSize, heights: new Float32Array(bytes.buffer) };
}

// --- Validation -------------------------------------------------------------------------------

type Obj = Record<string, unknown>;

function fail(path: string, what: string): never {
  throw new Error(`Escenario no válido: ${path} ${what}`);
}
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
function num(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}.${key}`, 'debe ser un número');
  return v;
}
function positive(o: Obj, key: string, path: string): number {
  const v = num(o, key, path);
  if (v <= 0) fail(`${path}.${key}`, 'debe ser mayor que 0');
  return v;
}
function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string') fail(`${path}.${key}`, 'debe ser un texto');
  return v;
}
function vec2(v: unknown, path: string): [number, number] {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) fail(path, 'debe ser [x, z]');
  return [v[0], v[1]];
}

function parseTerrain(v: unknown): ScenarioTerrain {
  if (!isObj(v)) fail('terrain', 'falta');
  const label = typeof v.label === 'string' ? { label: v.label } : {};
  switch (v.kind) {
    case 'synthetic':
      return { kind: 'synthetic', size_m: positive(v, 'size_m', 'terrain') };
    case 'dem-ref': {
      const format = v.format;
      if (format !== 'geotiff' && format !== 'png16') fail('terrain.format', 'debe ser "geotiff" o "png16"');
      const png = isObj(v.png)
        ? { png: { cellSize: num(v.png, 'cellSize', 'terrain.png'), minElevation: num(v.png, 'minElevation', 'terrain.png'), maxElevation: num(v.png, 'maxElevation', 'terrain.png') } }
        : {};
      return { kind: 'dem-ref', uri: str(v, 'uri', 'terrain'), format, ...png, ...label };
    }
    case 'dem-inline': {
      if (v.encoding !== 'float32-base64') fail('terrain.encoding', 'debe ser "float32-base64"');
      const resolution = num(v, 'resolution', 'terrain');
      if (!Number.isInteger(resolution) || resolution < 2) fail('terrain.resolution', 'debe ser un entero ≥ 2');
      return { kind: 'dem-inline', resolution, cellSize: positive(v, 'cellSize', 'terrain'), encoding: 'float32-base64', data: str(v, 'data', 'terrain'), ...label };
    }
    default:
      return fail('terrain.kind', `"${String(v.kind)}" no es un tipo de terreno conocido (synthetic, dem-ref, dem-inline)`);
  }
}

const RHEOLOGIES: RheologyModel[] = ['voellmy', 'bingham', 'herschel-bulkley'];

function parseMaterial(v: unknown): MaterialParams {
  if (!isObj(v)) fail('material', 'falta');
  if (!RHEOLOGIES.includes(v.rheology as RheologyModel)) fail('material.rheology', `debe ser uno de ${RHEOLOGIES.join(', ')}`);
  const m = (k: string) => num(v, k, 'material');
  const p = (k: string) => positive(v, k, 'material');
  return { rheology: v.rheology as RheologyModel, mu: m('mu'), xi: p('xi'), yieldStress: m('yieldStress'), viscosity: p('viscosity'), flowIndex: p('flowIndex'), density: p('density') };
}

function parseCommand(v: unknown, path: string): EditCommand {
  if (!isObj(v)) fail(path, 'debe ser un objeto');
  const id = str(v, 'id', path);
  switch (v.type) {
    case 'source':
      return { type: 'source', id, pos: vec2(v.pos, `${path}.pos`), radius: positive(v, 'radius', path), volume: positive(v, 'volume', path), peakDischarge: positive(v, 'peakDischarge', path) };
    case 'wall': {
      if (!Array.isArray(v.points) || v.points.length < 2) fail(`${path}.points`, 'necesita al menos dos puntos');
      const material = v.material ?? 'earth';
      if (material !== 'earth' && material !== 'concrete') fail(`${path}.material`, 'debe ser "earth" o "concrete"');
      return {
        type: 'wall', id, points: v.points.map((p, k) => vec2(p, `${path}.points[${k}]`)),
        halfWidth: positive(v, 'halfWidth', path), height: positive(v, 'height', path), material,
      };
    }
    case 'erase':
      return { type: 'erase', id, target: str(v, 'target', path) };
    default:
      return fail(`${path}.type`, `"${String(v.type)}" no es un comando conocido (source, wall, erase)`);
  }
}

export function parseScenario(json: string): Scenario {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Escenario no válido: el fichero no es JSON');
  }
  if (!isObj(data) || data.format !== SCENARIO_FORMAT) throw new Error(`Escenario no válido: no es un escenario de este simulador (format debe ser "${SCENARIO_FORMAT}")`);
  if (data.version !== SCENARIO_VERSION) throw new Error(`Escenario no válido: versión ${String(data.version)} no soportada (esta app lee la versión ${SCENARIO_VERSION})`);
  if (!Array.isArray(data.commands)) fail('commands', 'debe ser una lista');
  const commands = data.commands.map((c, k) => parseCommand(c, `commands[${k}]`));
  const sim = isObj(data.simulation) ? data.simulation : {};
  return buildScenario({
    name: typeof data.name === 'string' ? data.name : 'escenario',
    terrain: parseTerrain(data.terrain),
    material: parseMaterial(data.material),
    commands,
    speed: typeof sim.speed === 'number' && sim.speed > 0 ? sim.speed : 10,
  });
}
