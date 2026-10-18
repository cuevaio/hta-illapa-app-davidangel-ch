import './base.css';
import { FreeCamera, Scene, Vector3, WebGPUEngine } from '@babylonjs/core';
import type { WallCommand } from '../edit/commands';
import { applyEditCpu, type EditBatch } from '../edit/walls';
import { createSyntheticRavine, syntheticEmitterPosition, Terrain } from '../scenario/terrain';
import { CpuSolver } from '../solver/cpu/CpuSolver';
import { LocalGpuSolver } from '../solver/gpu/LocalGpuSolver';
import { DEFAULT_MATERIAL, defaultEmitter, triangularHydrograph } from '../solver/params';

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

const N = 128;
const wall = (id: string, points: [number, number][], halfWidth = 24, height = 10, material: WallCommand['material'] = 'earth'): WallCommand =>
  ({ type: 'wall', id, points, halfWidth, height, material });
const A = wall('a', [[600, 900], [700, 1000], [800, 1050]]);
const B = wall('b', [[1300, 700], [1300, 1400]], 30, 12);
const C = wall('c', [[300, 1000], [450, 1100]], 0.5, 6, 'concrete');

async function main() {
  const app = document.getElementById('app')!;
  const table = document.createElement('table');
  app.append(table);
  const results: Result[] = [];
  const report = (r: Result) => {
    results.push(r);
    const tr = table.insertRow();
    tr.insertCell().textContent = r.name;
    const c = tr.insertCell();
    c.textContent = r.ok ? 'PASA' : 'FALLA';
    c.className = r.ok ? 'ok' : 'err';
    tr.insertCell().textContent = r.detail;
  };

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const engine = new WebGPUEngine(canvas);
  await engine.initAsync();
  const scene = new Scene(engine);
  new FreeCamera('cam', new Vector3(0, 0, -1), scene);
  engine.runRenderLoop(() => scene.render());
  const nextFrame = () => new Promise<void>((r) => engine.onEndFrameObservable.addOnce(() => r()));

  const grid = createSyntheticRavine(N);
  const fresh = async () => {
    const t = new Terrain(grid);
    const s = await LocalGpuSolver.create(engine, N, t.cellSize, t.base, t.effective);
    s.setMaterial(DEFAULT_MATERIAL);
    return { t, s };
  };
  const edit = async (s: LocalGpuSolver, t: Terrain | null, batch: EditBatch) => {
    await nextFrame();
    s.applyEdit(batch);
    if (t) applyEditCpu(t.effective, t.base, N, t.cellSize, batch);
    await nextFrame();
  };
  const bitsEqual = (a: Float32Array, b: Float32Array) => {
    const ua = new Uint32Array(a.buffer, a.byteOffset, a.length);
    const ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
    let diff = 0;
    for (let k = 0; k < ua.length; k++) if (ua[k] !== ub[k]) diff++;
    return diff;
  };

  // 1. Apply a wall, undo it: GPU terrain must be bit-identical to before.
  {
    const { s } = await fresh();
    await edit(s, null, { mode: 'incremental', walls: [B] });
    const before = await s.readTerrain();
    await edit(s, null, { mode: 'incremental', walls: [A] });
    const withA = await s.readTerrain();
    await edit(s, null, { mode: 'replay', walls: [B] }); // undo A
    const after = await s.readTerrain();
    const changed = bitsEqual(before, withA);
    const diff = bitsEqual(before, after);
    report({ name: 'Aplicar y deshacer un muro (GPU, bit a bit)', ok: changed > 0 && diff === 0, detail: `${changed} celdas cambiadas por el muro; ${diff} celdas distintas tras deshacer` });
    s.dispose();
  }

  // 2. CPU copy and GPU buffer agree after a sequence of edits.
  {
    const { t, s } = await fresh();
    const steps: [string, EditBatch][] = [
      ['muro A', { mode: 'incremental', walls: [A] }],
      ['muro B', { mode: 'incremental', walls: [B] }],
      ['borrar A', { mode: 'replay', walls: [B] }],
      ['muro C', { mode: 'incremental', walls: [C] }],
      ['deshacer C', { mode: 'replay', walls: [B] }],
      ['rehacer C', { mode: 'incremental', walls: [C] }],
    ];
    let worst = 0;
    for (const [, batch] of steps) {
      await edit(s, t, batch);
      const gpu = await s.readTerrain();
      for (let k = 0; k < gpu.length; k++) worst = Math.max(worst, Math.abs(gpu[k] - t.effective[k]));
    }
    report({ name: 'Copia CPU = buffer GPU tras 6 ediciones (berma y concreto)', ok: worst < 1e-3, detail: `diferencia máxima ${worst.toExponential(2)} m` });
    s.dispose();
  }

  // 3. A wall raised under fluid removes it and tallies the removed volume.
  {
    const { t, s } = await fresh();
    const cells = N * N;
    const h = new Float32Array(cells);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (Math.abs((i + 0.5) * t.cellSize - 1300) < 80) h[j * N + i] = 2;
    s.loadState({ h, hu: new Float32Array(cells), hv: new Float32Array(cells) });
    await nextFrame();
    const v0 = (await s.readStats()).volume;
    await edit(s, null, { mode: 'incremental', walls: [B] });
    const st = await s.readStats();
    const balance = Math.abs(st.volume + st.editRemovedVolume - v0) / v0;
    report({
      name: 'Muro sobre flujo: volumen retirado contabilizado',
      ok: st.editRemovedVolume > 0 && balance < 1e-4,
      detail: `antes ${v0.toFixed(0)} m³, después ${st.volume.toFixed(0)} m³, retirado ${st.editRemovedVolume.toFixed(1)} m³, desbalance ${balance.toExponential(2)}`,
    });
    s.dispose();
  }

  // 4. GPU solver vs CPU reference on the same small case.
  {
    const { t, s } = await fresh();
    // Two origins, the second starting later, to exercise the multi-emitter path.
    const p = syntheticEmitterPosition();
    const emitters = [defaultEmitter(p), { ...defaultEmitter([p[0] + 250, p[1] + 150]), hydrograph: triangularHydrograph(20_000, 200), startTime: 20 }];
    s.setEmitters(emitters);
    const cpu = new CpuSolver(N, t.cellSize, t.effective);
    cpu.setMaterial(DEFAULT_MATERIAL);
    cpu.setEmitters(emitters);
    const T = 90;
    for (let k = 0; k < 2000; k++) {
      await nextFrame();
      const st = await s.readStats();
      if (st.simTime >= T - 1e-3) break;
      s.advance(Math.min(T - st.simTime, 2), 64);
    }
    cpu.advance(T, 100_000);
    const g = await s.readState();
    const c = cpu.stateSync();
    let diff = 0;
    let sum = 0;
    for (let k = 0; k < g.h.length; k++) {
      diff += Math.abs(g.h[k] - c.h[k]);
      sum += c.h[k];
    }
    const rel = diff / sum;
    report({ name: 'Solver GPU vs CPU de referencia (128², 90 s, dos orígenes)', ok: rel < 0.01, detail: `diferencia L1 relativa en h: ${(rel * 100).toFixed(3)} %` });
    s.dispose();
  }

  engine.stopRenderLoop();
  const done = document.createElement('p');
  const passed = results.filter((r) => r.ok).length;
  done.textContent = `${passed}/${results.length} pruebas pasan.`;
  done.className = passed === results.length ? 'ok' : 'err';
  app.append(done);
  Object.assign(window, { __results: results });
}

main().catch((err) => {
  document.getElementById('app')!.append(`Error: ${String(err)}`);
  Object.assign(window, { __results: [{ name: 'arranque', ok: false, detail: String(err) }] });
});
