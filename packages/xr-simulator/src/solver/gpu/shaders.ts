import { MAX_EMITTERS } from "../params";

/**
 * WGSL kernels of the GPU solver. The numerics mirror src/solver/numerics.ts
 * and src/solver/cpu/CpuSolver.ts; keep both in sync.
 *
 * Buffers:
 *  - params   (uniform)  solver constants and material, rewritten on slider change
 *  - emitters (uniform)  up to MAX_EMITTERS origins: position, radius, start time, hydrograph
 *  - ctrl     (storage)  GPU-side clock: CFL speed, t, dt, injected volume, per-origin cells and discharge
 *  - terrain  (storage)  effective terrain (base + edits)
 *  - state A/B (storage) vec4(h, hu, hv, 0) per cell, ping-pong
 */

export const WORKGROUP = 16;

/** Float offsets inside the params uniform (see `Params` below). */
export const PARAMS_LAYOUT = {
	n: 0,
	dx: 1,
	g: 2,
	cfl: 3,
	dtMax: 4,
	hDry: 5,
	model: 6,
	mu: 7,
	xi: 8,
	yieldOverRho: 9,
	consistencyOverRho: 10,
	flowIndex: 11,
	advance: 12,
	colorMode: 13,
	depthScale: 14,
	speedScale: 15,
	hVisible: 16,
	dryOffset: 17,
	floats: 20,
} as const;

/** Floats per origin in the emitters uniform (see `Emitter` below), after a 4-float header. */
export const EMITTER_FLOATS = 40;
export const EMITTERS_HEADER_FLOATS = 4;
/** Byte offsets inside the ctrl storage buffer. */
export const CTRL_LAYOUT = {
	speedBits: 0,
	steps: 8,
	t: 16,
	dt: 20,
	tgt: 24,
	injected: 28,
	q: 36,
	editRemoved: 40,
	cells: 48,
	qs: 80,
	bytes: 112,
} as const;
/** Fluid removed by edits is tallied as an integer number of litres (atomics are integer-only). */
export const EDIT_REMOVED_UNIT = 1e-3;

const COMMON = /* wgsl */ `
struct Params {
  n: u32, dx: f32, g: f32, cfl: f32,
  dtMax: f32, hDry: f32, model: u32, mu: f32,
  xi: f32, yieldOverRho: f32, consistencyOverRho: f32, flowIndex: f32,
  advance: f32, colorMode: u32, depthScale: f32, speedScale: f32,
  hVisible: f32, dryOffset: f32, _p0: f32, _p1: f32,
};

struct Emitter {
  pos: vec2<f32>, radius: f32, enabled: u32,
  count: u32, start: f32, _e1: u32, _e2: u32,
  pts: array<vec4<f32>, 8>,
};

struct Emitters {
  n: u32, _h0: u32, _h1: u32, _h2: u32,
  e: array<Emitter, ${MAX_EMITTERS}>,
};

struct Ctrl {
  speedBits: atomic<u32>, _c3: u32, steps: u32, _c0: u32,
  t: f32, dt: f32, tgt: f32, injected: f32,
  injectedComp: f32, q: f32, editRemoved: atomic<u32>, _c2: f32,
  cells: array<atomic<u32>, ${MAX_EMITTERS}>,
  qs: array<f32, ${MAX_EMITTERS}>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<uniform> emitters: Emitters;
@group(0) @binding(2) var<storage, read_write> ctrl: Ctrl;

fn inEmitter(e: u32, i: u32, j: u32) -> bool {
  let d = vec2<f32>((f32(i) + 0.5) * params.dx, (f32(j) + 0.5) * params.dx) - emitters.e[e].pos;
  let r = emitters.e[e].radius;
  return dot(d, d) <= r * r;
}
`;

export const BEGIN_FRAME_WGSL =
	COMMON +
	/* wgsl */ `
@compute @workgroup_size(1)
fn main() {
  ctrl.tgt = ctrl.t + params.advance;
}
`;

export const COMPUTE_DT_WGSL =
	COMMON +
	/* wgsl */ `
fn hpt(e: u32, k: u32) -> vec2<f32> {
  let v = emitters.e[e].pts[k / 2u];
  if ((k & 1u) == 0u) { return v.xy; }
  return v.zw;
}

fn dischargeAt(e: u32, t: f32) -> f32 {
  let n = emitters.e[e].count;
  if (n == 0u) { return 0.0; }
  if (t < hpt(e, 0u).x || t >= hpt(e, n - 1u).x) { return 0.0; }
  for (var k = 1u; k < n; k++) {
    let b = hpt(e, k);
    if (t < b.x) {
      let a = hpt(e, k - 1u);
      let span = b.x - a.x;
      if (span > 0.0) { return a.y + (t - a.x) / span * (b.y - a.y); }
      return b.y;
    }
  }
  return 0.0;
}

@compute @workgroup_size(1)
fn main() {
  let s = bitcast<f32>(atomicLoad(&ctrl.speedBits));
  var dt = params.dtMax;
  if (s > 0.0) { dt = min(dt, params.cfl * params.dx / s); }
  dt = min(dt, max(ctrl.tgt - ctrl.t, 0.0));
  var q = 0.0;
  for (var e = 0u; e < emitters.n; e++) {
    var qe = 0.0;
    if (emitters.e[e].enabled != 0u && atomicLoad(&ctrl.cells[e]) > 0u) { qe = dischargeAt(e, ctrl.t - emitters.e[e].start); }
    ctrl.qs[e] = qe;
    q += qe;
  }
  // Kahan summation keeps the injected-volume tally accurate in f32.
  let y = q * dt - ctrl.injectedComp;
  let sum = ctrl.injected + y;
  ctrl.injectedComp = (sum - ctrl.injected) - y;
  ctrl.injected = sum;
  ctrl.q = q;
  ctrl.dt = dt;
  ctrl.t = ctrl.t + dt;
  if (dt > 0.0) { ctrl.steps = ctrl.steps + 1u; }
  atomicStore(&ctrl.speedBits, 0u);
}
`;

// Clearing on the GPU keeps it ordered with the count dispatch. A queue.writeBuffer
// would run before every dispatch of the frame, so two recounts in one frame would add up.
export const CLEAR_EMITTER_WGSL =
	COMMON +
	/* wgsl */ `
@compute @workgroup_size(1)
fn main() {
  for (var e = 0u; e < ${MAX_EMITTERS}u; e++) { atomicStore(&ctrl.cells[e], 0u); }
}
`;

export const COUNT_EMITTER_WGSL =
	COMMON +
	/* wgsl */ `
@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.n || gid.y >= params.n) { return; }
  for (var e = 0u; e < emitters.n; e++) {
    if (inEmitter(e, gid.x, gid.y)) { atomicAdd(&ctrl.cells[e], 1u); }
  }
}
`;

export const UPDATE_WGSL =
	COMMON +
	/* wgsl */ `
@group(0) @binding(3) var<storage, read> terrain: array<f32>;
@group(0) @binding(4) var<storage, read> stateIn: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> stateOut: array<vec4<f32>>;

var<workgroup> wmax: array<f32, ${WORKGROUP * WORKGROUP}>;

fn vel(h: f32, m: f32) -> f32 {
  if (h > params.hDry) { return m / h; }
  return 0.0;
}

// HLL flux for reconstructed states; returns (mass, normal momentum, tangential momentum).
fn hll(hl: f32, unl: f32, utl: f32, hr: f32, unr: f32, utr: f32) -> vec3<f32> {
  if (hl <= 0.0 && hr <= 0.0) { return vec3<f32>(0.0); }
  let g = params.g;
  let cl = sqrt(g * hl);
  let cr = sqrt(g * hr);
  var sl: f32;
  var sr: f32;
  if (hl <= 0.0) { sl = unr - 2.0 * cr; } else if (hr <= 0.0) { sl = unl - cl; } else { sl = min(unl - cl, unr - cr); }
  if (hr <= 0.0) { sr = unl + 2.0 * cl; } else if (hl <= 0.0) { sr = unr + cr; } else { sr = max(unl + cl, unr + cr); }
  let fl = vec3<f32>(hl * unl, hl * unl * unl + 0.5 * g * hl * hl, hl * unl * utl);
  let fr = vec3<f32>(hr * unr, hr * unr * unr + 0.5 * g * hr * hr, hr * unr * utr);
  if (sl >= 0.0) { return fl; }
  if (sr <= 0.0) { return fr; }
  let ul = vec3<f32>(hl, hl * unl, hl * utl);
  let ur = vec3<f32>(hr, hr * unr, hr * utr);
  return (sr * fl - sl * fr + sl * sr * (ur - ul)) / (sr - sl);
}

struct FaceFlux { left: vec3<f32>, right: vec3<f32> };

// Hydrostatic reconstruction of Chen & Noelle (2017), eqs. 2.15-2.18: well-balanced,
// positivity preserving, and keeps the gravity force when h < bed step (steep slopes).
// Each side's interface source term is folded into its normal momentum flux.
fn faceFlux(hL: f32, unL: f32, utL: f32, zL: f32, hR: f32, unR: f32, utR: f32, zR: f32) -> FaceFlux {
  let wL = hL + zL;
  let wR = hR + zR;
  let zf = min(max(zL, zR), min(wL, wR));
  let hl = max(0.0, min(wL - zf, hL));
  let hr = max(0.0, min(wR - zf, hR));
  let f = hll(hl, unL, utL, hr, unR, utR);
  let g = params.g;
  return FaceFlux(
    vec3<f32>(f.x, f.y + g * 0.5 * (hL + hl) * (zf - zL), f.z),
    vec3<f32>(f.x, f.y - g * 0.5 * (hr + hR) * (zR - zf), f.z),
  );
}

fn frictionScale(h: f32, m: f32, dt: f32) -> f32 {
  if (h < params.hDry || m <= 0.0) { return 0.0; }
  let u = m / h;
  var num: f32;
  var den: f32;
  if (params.model == 0u) {
    num = max(m - dt * params.mu * params.g * h, 0.0);
    den = 1.0 + dt * params.g * u / (params.xi * h);
  } else {
    let n = params.flowIndex;
    num = max(m - dt * params.yieldOverRho, 0.0);
    let k = params.consistencyOverRho * pow(3.0, n) * pow(max(u, 1e-6), n - 1.0) / pow(h, n + 1.0);
    den = 1.0 + dt * k;
  }
  return num / den / m;
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let n = params.n;
  var speed = 0.0;
  if (gid.x < n && gid.y < n) {
    let i = gid.x;
    let j = gid.y;
    let k = j * n + i;
    let c = stateIn[k];
    let hc = c.x;
    let uc = vel(hc, c.y);
    let vc = vel(hc, c.z);
    let zc = terrain[k];
    var d = vec3<f32>(0.0); // (dh, dmx, dmy)

    // East face: this cell is the left state; walls mirror it.
    var f: FaceFlux;
    if (i + 1u < n) {
      let e = stateIn[k + 1u];
      f = faceFlux(hc, uc, vc, zc, e.x, vel(e.x, e.y), vel(e.x, e.z), terrain[k + 1u]);
    } else { f = faceFlux(hc, uc, vc, zc, hc, -uc, vc, zc); }
    d -= f.left;

    // West face: this cell is the right state.
    if (i > 0u) {
      let w = stateIn[k - 1u];
      f = faceFlux(w.x, vel(w.x, w.y), vel(w.x, w.z), terrain[k - 1u], hc, uc, vc, zc);
    } else { f = faceFlux(hc, -uc, vc, zc, hc, uc, vc, zc); }
    d += f.right;

    // North face (j + 1/2): normal velocity v, tangential u.
    if (j + 1u < n) {
      let s = stateIn[k + n];
      f = faceFlux(hc, vc, uc, zc, s.x, vel(s.x, s.z), vel(s.x, s.y), terrain[k + n]);
    } else { f = faceFlux(hc, vc, uc, zc, hc, -vc, uc, zc); }
    d -= f.left.xzy;

    // South face (j - 1/2).
    if (j > 0u) {
      let s = stateIn[k - n];
      f = faceFlux(s.x, vel(s.x, s.z), vel(s.x, s.y), terrain[k - n], hc, vc, uc, zc);
    } else { f = faceFlux(hc, -vc, uc, zc, hc, vc, uc, zc); }
    d += f.right.xzy;

    let dt = ctrl.dt;
    let r = dt / params.dx;
    var h = max(0.0, hc + r * d.x);
    var mx = c.y + r * d.y;
    var my = c.z + r * d.z;

    for (var e = 0u; e < emitters.n; e++) {
      let qe = ctrl.qs[e];
      if (qe > 0.0 && inEmitter(e, i, j)) {
        h += qe * dt / (f32(atomicLoad(&ctrl.cells[e])) * params.dx * params.dx);
      }
    }

    if (h < params.hDry) {
      mx = 0.0;
      my = 0.0;
    } else {
      let fs = frictionScale(h, length(vec2<f32>(mx, my)), dt);
      mx *= fs;
      my *= fs;
      speed = (abs(mx) + abs(my)) / h + 2.0 * sqrt(params.g * h);
    }
    stateOut[k] = vec4<f32>(h, mx, my, 0.0);
  }

  // Workgroup max reduction, then one atomic per workgroup (floats >= 0 order like u32).
  wmax[li] = speed;
  workgroupBarrier();
  for (var s = ${(WORKGROUP * WORKGROUP) / 2}u; s > 0u; s >>= 1u) {
    if (li < s) { wmax[li] = max(wmax[li], wmax[li + s]); }
    workgroupBarrier();
  }
  if (li == 0u && wmax[0] > 0.0) { atomicMax(&ctrl.speedBits, bitcast<u32>(wmax[0])); }
}
`;

export const STATS_WGSL =
	COMMON +
	/* wgsl */ `
@group(0) @binding(3) var<storage, read> state: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> partials: array<vec4<f32>>;

const WG: u32 = ${WORKGROUP * WORKGROUP}u;
var<workgroup> wsum: array<f32, WG>;
var<workgroup> wmaxh: array<f32, WG>;
var<workgroup> wmaxs: array<f32, WG>;
var<workgroup> wwet: array<f32, WG>;
var<workgroup> wminh: array<f32, WG>;

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) li: u32,
        @builtin(workgroup_id) wid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
  let n = params.n;
  var h = 0.0;
  var spd = 0.0;
  var wet = 0.0;
  var minh = 3.0e38;
  if (gid.x < n && gid.y < n) {
    let c = state[gid.y * n + gid.x];
    h = c.x;
    minh = c.x;
    if (h > params.hDry) {
      wet = 1.0;
      spd = length(c.yz) / h;
    }
  }
  wsum[li] = h; wmaxh[li] = h; wmaxs[li] = spd; wwet[li] = wet; wminh[li] = minh;
  workgroupBarrier();
  for (var s = WG / 2u; s > 0u; s >>= 1u) {
    if (li < s) {
      wsum[li] += wsum[li + s];
      wmaxh[li] = max(wmaxh[li], wmaxh[li + s]);
      wmaxs[li] = max(wmaxs[li], wmaxs[li + s]);
      wwet[li] += wwet[li + s];
      wminh[li] = min(wminh[li], wminh[li + s]);
    }
    workgroupBarrier();
  }
  if (li == 0u) {
    let w = wid.y * nwg.x + wid.x;
    partials[2u * w] = vec4<f32>(wsum[0], wmaxh[0], wmaxs[0], wwet[0]);
    partials[2u * w + 1u] = vec4<f32>(wminh[0], 0.0, 0.0, 0.0);
  }
}
`;

/**
 * Terrain edit pass, run before the solver step. Adds capsule-profiled walls
 * to the effective terrain (incremental) or rebuilds it from the base (replay),
 * then removes the fluid the raised bed now occupies and tallies its volume.
 * Mirrored by applyEditCpu (src/edit/walls.ts).
 */
export const EDIT_WGSL =
	COMMON +
	/* wgsl */ `
struct EditHeader { mode: u32, count: u32, i0: u32, j0: u32, ni: u32, nj: u32, _a: u32, _b: u32 };

@group(0) @binding(3) var<storage, read_write> terrain: array<f32>;
@group(0) @binding(4) var<storage, read> baseTerrain: array<f32>;
@group(0) @binding(5) var<storage, read_write> state: array<vec4<f32>>;
@group(0) @binding(6) var<uniform> edit: EditHeader;
@group(0) @binding(7) var<storage, read> cmds: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read> segs: array<vec4<f32>>;

var<workgroup> wsum: array<f32, ${WORKGROUP * WORKGROUP}>;

fn distToSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let v = b - a;
  let len2 = dot(v, v);
  var t = 0.0;
  if (len2 > 0.0) { t = clamp(dot(p - a, v) / len2, 0.0, 1.0); }
  return length(p - a - t * v);
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  var removed = 0.0;
  if (gid.x < edit.ni && gid.y < edit.nj) {
    let i = edit.i0 + gid.x;
    let j = edit.j0 + gid.y;
    let k = j * params.n + i;
    let old = terrain[k];
    var z = old;
    if (edit.mode == 1u) { z = baseTerrain[k]; }
    let p = vec2<f32>((f32(i) + 0.5) * params.dx, (f32(j) + 0.5) * params.dx);
    for (var c = 0u; c < edit.count; c++) {
      let head = cmds[3u * c];
      let bb = cmds[3u * c + 1u];
      let crest = cmds[3u * c + 2u].x;
      if (p.x < bb.x || p.x > bb.z || p.y < bb.y || p.y > bb.w) { continue; }
      let start = u32(head.x);
      let end = start + u32(head.y);
      var d = 3.0e38;
      for (var s = start; s < end; s++) { d = min(d, distToSegment(p, segs[s].xy, segs[s].zw)); }
      let w = 1.0 - smoothstep(head.z * crest, head.z, d);
      z = z + w * head.w;
    }
    terrain[k] = z;
    let dz = z - old;
    if (dz > 0.0) {
      let c = state[k];
      if (c.x > 0.0) {
        let r = min(c.x, dz);
        let f = (c.x - r) / c.x;
        state[k] = vec4<f32>(c.x - r, c.y * f, c.z * f, 0.0);
        removed = r;
      }
    }
  }
  wsum[li] = removed;
  workgroupBarrier();
  for (var s = ${(WORKGROUP * WORKGROUP) / 2}u; s > 0u; s >>= 1u) {
    if (li < s) { wsum[li] += wsum[li + s]; }
    workgroupBarrier();
  }
  if (li == 0u && wsum[0] > 0.0) {
    atomicAdd(&ctrl.editRemoved, u32(round(wsum[0] * params.dx * params.dx / ${EDIT_REMOVED_UNIT})));
  }
}
`;

/** Writes the flow-surface vertex buffers (positions, normals, colours) for the renderer. */
export const SURFACE_WGSL =
	COMMON +
	/* wgsl */ `
@group(0) @binding(3) var<storage, read> terrain: array<f32>;
@group(0) @binding(4) var<storage, read> state: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> normals: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> colors: array<vec4<f32>>;

fn surfaceHeight(i: u32, j: u32) -> f32 {
  let k = j * params.n + i;
  let h = state[k].x;
  if (h > params.hVisible) { return terrain[k] + h; }
  return terrain[k];
}

fn ramp(t: f32, mode: u32) -> vec3<f32> {
  // Depth: light mud to dark mud. Speed: blue -> yellow -> red.
  if (mode == 0u) {
    let a = vec3<f32>(0.78, 0.66, 0.48);
    let b = vec3<f32>(0.55, 0.38, 0.22);
    let c = vec3<f32>(0.25, 0.14, 0.07);
    if (t < 0.5) { return mix(a, b, t * 2.0); }
    return mix(b, c, t * 2.0 - 1.0);
  }
  let a = vec3<f32>(0.15, 0.35, 0.85);
  let b = vec3<f32>(0.95, 0.85, 0.2);
  let c = vec3<f32>(0.85, 0.12, 0.08);
  if (t < 0.5) { return mix(a, b, t * 2.0); }
  return mix(b, c, t * 2.0 - 1.0);
}

@compute @workgroup_size(${WORKGROUP}, ${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = params.n;
  if (gid.x >= n || gid.y >= n) { return; }
  let i = gid.x;
  let j = gid.y;
  let k = j * n + i;
  let c = state[k];
  let h = c.x;
  let z = terrain[k];
  let wet = h > params.hVisible;
  var y = z - params.dryOffset;
  if (wet) { y = z + h; }
  positions[k] = vec4<f32>((f32(i) + 0.5) * params.dx, y, (f32(j) + 0.5) * params.dx, 1.0);

  let hx = surfaceHeight(min(i + 1u, n - 1u), j) - surfaceHeight(select(i - 1u, 0u, i == 0u), j);
  let hz = surfaceHeight(i, min(j + 1u, n - 1u)) - surfaceHeight(i, select(j - 1u, 0u, j == 0u));
  normals[k] = vec4<f32>(normalize(vec3<f32>(-hx, 2.0 * params.dx, -hz)), 0.0);

  var t: f32;
  if (params.colorMode == 0u) { t = h / params.depthScale; } else { t = length(c.yz) / max(h, params.hDry) / params.speedScale; }
  var alpha = 0.0;
  if (wet) { alpha = 0.92; }
  colors[k] = vec4<f32>(ramp(clamp(t, 0.0, 1.0), params.colorMode), alpha);
}
`;
