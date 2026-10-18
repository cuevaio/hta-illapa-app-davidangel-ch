import { DT_MAX, dischargeAt } from "../solver/params";
import type { HydrographPoint, MaterialParams } from "../solver/Solver";

/** Validation case as the external solvers need it (terrain-local metres; y = simulator z). */
export interface ExternalCase {
	n: number;
	cellSize: number;
	material: MaterialParams;
	emitter: {
		position: [number, number];
		radius: number;
		hydrograph: HydrographPoint[];
	};
	duration: number;
	threshold: number;
}

const num = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * r.avaflow hydrograph file: header + T (s), Q1 (m³/s), V1 (m/s). r.avaflow reads it as a step
 * function, so each row holds the mean discharge of its interval (midpoint of the linear ramp).
 */
export function ravaflowHydrograph(
	points: HydrographPoint[],
	dt: number,
	velocity = 1,
): string {
	const end = points[points.length - 1].t;
	const rows = ["T\tQ1\tV1"];
	for (let t = 0; t < end - 1e-9; t += dt) {
		const q = dischargeAt(points, Math.min(t + dt / 2, end - 1e-9));
		rows.push(`${num(t)}\t${num(q)}\t${velocity}`);
	}
	rows.push(`${num(end)}\t0\t0`);
	return rows.join("\n") + "\n";
}

/** GRASS session script for r.avaflow 4.0G (Linux). Unverified parts are marked in the comments. */
export function ravaflowScript(c: ExternalCase): string {
	const delta = (Math.atan(c.material.mu) * 180) / Math.PI;
	const [x, y] = c.emitter.position;
	return `#!/usr/bin/env bash
# Runs this case in r.avaflow 4.0G inside a GRASS session (Linux; on macOS use a Linux VM or Docker):
#   grass -e -c dem.asc ~/grassdata/huaico_case
#   grass ~/grassdata/huaico_case/PERMANENT --exec bash run.sh
# Writes external/hmax.asc and external/arrival.asc for tools/compare_results.py.
set -euo pipefail
cd "$(dirname "$0")/.."
r.in.gdal -o --overwrite input=dem.asc output=dem
g.region -s raster=dem
# Voellmy: basal friction angle delta = atan(mu) = ${delta.toFixed(2)} deg, turbulent xi = ${c.material.xi} m/s2 (negative = turbulent).
# The internal friction angle (first value) is a placeholder: check its sensitivity (UNVERIFIED for one phase).
# The inflow is a line of ${2 * c.emitter.radius} m across the steepest slope through the disk centre (r.avaflow has no disk inflow).
# Edge cells are not computed by r.avaflow (this simulator uses reflective edges); the flow should not reach them.
r.avaflow.40G prefix=cmp phases=1 elevation=dem density=${c.material.density} \\
  friction=20,${delta.toFixed(2)},-${c.material.xi} \\
  time=10,${c.duration} thresholds=${c.threshold},10000,10000,1.0,0.000001 \\
  hydrograph=ravaflow/hydrograph.txt hydrocoords=${num(x)},${num(y)},${2 * c.emitter.radius},-9999
mkdir -p external
r.out.gdal --overwrite input=cmp_hflow_max output=external/hmax.asc format=AAIGrid
r.out.gdal --overwrite input=cmp_treach output=external/arrival.asc format=AAIGrid
`;
}

/** Basilisk (saint-venant.h) program with the same inflow disk, Voellmy friction and outputs. */
export function basiliskSource(c: ExternalCase): string {
	const [x, y] = c.emitter.position;
	const h = c.emitter.hydrograph;
	const ts = h.map((p) => num(p.t)).join(", ");
	const qs = h.map((p) => num(p.q)).join(", ");
	return `// Same case in Basilisk: qcc -O2 -Wall voellmy.c -o voellmy -lm && ./voellmy  (run from this folder)
// Writes ../external/hmax.asc and ../external/arrival.asc. Edges are reflective by default (symmetry).
#include "grid/multigrid.h"
#include "saint-venant.h"
#include "input.h"

#define MU ${num(c.material.mu)}
#define XI ${num(c.material.xi)}
#define XC ${num(x)}
#define YC ${num(y)}
#define R ${num(c.emitter.radius)}
#define HTHR ${num(c.threshold)}
#define NOARRIVAL -9999.

static const double HT[] = {${ts}};
static const double HQ[] = {${qs}};
static const int HN = ${h.length};

scalar hmax[], tarr[];

// Piecewise-linear discharge (m3/s), zero outside the hydrograph (as the simulator's dischargeAt).
double Q (double t) {
  if (t < HT[0] || t >= HT[HN - 1]) return 0.;
  for (int k = 1; k < HN; k++)
    if (t < HT[k]) return HQ[k - 1] + (t - HT[k - 1])/(HT[k] - HT[k - 1])*(HQ[k] - HQ[k - 1]);
  return 0.;
}

int main() {
  G = 9.81;
  // Maximum time step as in the simulator (DT_MAX): otherwise the first step over a dry domain
  // jumps straight to the end time.
  DT = ${num(DT_MAX)};
  L0 = ${num(c.n * c.cellSize)}; X0 = 0.; Y0 = 0.;
  N = ${c.n};
  run();
}

event init (i = 0) {
  input_grd (zb, file = "../dem.asc");
  foreach() { h[] = 0.; eta[] = zb[]; hmax[] = 0.; tarr[] = NOARRIVAL; }
}

// Depth source over the cells whose centres lie in the disk, without momentum.
event source (i++) {
  double A = 0.;
  foreach (reduction(+:A)) if (sq(x - XC) + sq(y - YC) < sq(R)) A += sq(Delta);
  double dh = A > 0. ? Q(t)*dt/A : 0.;
  foreach() if (dh > 0. && sq(x - XC) + sq(y - YC) < sq(R)) {
    double h0 = h[];
    h[] += dh;
    foreach_dimension() u.x[] *= h0/h[];
    eta[] = zb[] + h[];
  }
}

// Semi-implicit Voellmy friction exactly as the simulator's frictionScale (src/solver/numerics.ts):
// tau/rho = MU*G*h + G*u^2/XI without a slope cosine, Coulomb part only stops the flow, turbulent
// part implicit with the old speed. Then the maps.
event friction (i++) {
  foreach() {
    if (h[] > dry) {
      double U = norm(u);
      double Un = U - MU*G*dt;
      Un = Un > 0. ? Un/(1. + G*dt*U/(XI*h[])) : 0.;
      foreach_dimension() u.x[] = U > 0. ? u.x[]*Un/U : 0.;
    }
    else
      foreach_dimension() u.x[] = 0.;
    if (h[] > hmax[]) hmax[] = h[];
    if (tarr[] == NOARRIVAL && h[] >= HTHR) tarr[] = t;
  }
}

event end (t = ${c.duration}) {
  system ("mkdir -p ../external");
  FILE * f = fopen ("../external/hmax.asc", "w"); output_grd (hmax, f); fclose (f);
  f = fopen ("../external/arrival.asc", "w"); output_grd (tarr, f); fclose (f);
}
`;
}
