import { EARTH_CIRCUMFERENCE } from "../tileMath";
import { esNumber } from "./palette";

/**
 * Wind (GFS UGRD/VGRD 10 m, u > 0 toward the east, v > 0 toward the north, m/s) and the CPU
 * particle field that draws its trails (after peru-simulator's src/domain/wind*.ts; there the
 * particles run on the GPU, here on the CPU within a per-profile budget). Pure.
 * Particle positions are in the Web Mercator unit square (x east, y south) of the tiles.
 */

const COMPASS_16 = [
	"N",
	"NNE",
	"NE",
	"ENE",
	"E",
	"ESE",
	"SE",
	"SSE",
	"S",
	"SSO",
	"SO",
	"OSO",
	"O",
	"ONO",
	"NO",
	"NNO",
] as const;
const CALM_KMH = 1;

/** Meteorological direction (where it comes FROM), degrees: 0 = N, 90 = E. */
export function windDirectionFrom(u: number, v: number): number {
	const deg = (Math.atan2(-u, -v) * 180) / Math.PI;
	return ((deg % 360) + 360) % 360;
}

export function compassLabel(deg: number): string {
	const d = ((deg % 360) + 360) % 360;
	return COMPASS_16[Math.floor((d + 11.25) / 22.5) % 16];
}

/** "18 km/h del SO (225°)". */
export function formatWind(u: number, v: number): string {
	const kmh = Math.hypot(u, v) * 3.6;
	if (kmh < CALM_KMH) return `calma (< ${CALM_KMH} km/h)`;
	const dir = windDirectionFrom(u, v);
	return `${esNumber(kmh, 0)} km/h del ${compassLabel(dir)} (${Math.round(dir) % 360}°)`;
}

/**
 * Moves a world point by (u east, v north) m/s during `seconds`: Mercator stretches true metres
 * by 1 / cos(lat) = cosh(y_mercator / R).
 */
export function advectWorld(
	x: number,
	y: number,
	u: number,
	v: number,
	seconds: number,
): { x: number; y: number } {
	const my = (0.5 - y) * EARTH_CIRCUMFERENCE;
	const stretch = Math.cosh((my * 2 * Math.PI) / EARTH_CIRCUMFERENCE);
	return {
		x: x + (u * seconds * stretch) / EARTH_CIRCUMFERENCE,
		y: y - (v * seconds * stretch) / EARTH_CIRCUMFERENCE,
	};
}

/** Animation speed-up for a region of `sideMeters`: a 10 m/s wind crosses ~4 % of it per second at every zoom. */
export function animationSpeedFactor(sideMeters: number): number {
	return (0.04 * sideMeters) / 10;
}

/** Square region (world units) where particles live and trails are drawn. */
export interface Region {
	x0: number;
	y0: number;
	side: number;
}

const MIN_LIFE_S = 2.5;
const MAX_LIFE_S = 6;

/**
 * Fixed-size particle set: each step moves every particle by the sampled wind (true m/s times
 * `speedFactor`), keeping its previous position for the trail segment; particles that leave
 * the region, reach no data or outlive their 2.5–6 s life respawn at a random position.
 */
export class ParticleField {
	readonly x: Float64Array;
	readonly y: Float64Array;
	readonly px: Float64Array;
	readonly py: Float64Array;
	readonly age: Float32Array;
	readonly life: Float32Array;
	/** m/s of the last step (0 for a respawned particle: no segment). */
	readonly speed: Float32Array;

	constructor(
		readonly count: number,
		private readonly random: () => number = Math.random,
	) {
		this.x = new Float64Array(count);
		this.y = new Float64Array(count);
		this.px = new Float64Array(count);
		this.py = new Float64Array(count);
		this.age = new Float32Array(count);
		this.life = new Float32Array(count);
		this.speed = new Float32Array(count);
	}

	respawnAll(r: Region): void {
		for (let i = 0; i < this.count; i++) this.respawn(i, r);
	}

	/** Advances `dt` seconds; returns how many particles moved (drew a segment). */
	step(
		r: Region,
		dt: number,
		sample: (x: number, y: number) => { u: number; v: number } | null,
		speedFactor: number,
	): number {
		let moved = 0;
		const seconds = dt * speedFactor;
		for (let i = 0; i < this.count; i++) {
			this.age[i] += dt;
			const w =
				this.age[i] > this.life[i] ? null : sample(this.x[i], this.y[i]);
			if (!w) {
				this.respawn(i, r);
				continue;
			}
			const n = advectWorld(this.x[i], this.y[i], w.u, w.v, seconds);
			if (
				n.x < r.x0 ||
				n.y < r.y0 ||
				n.x > r.x0 + r.side ||
				n.y > r.y0 + r.side
			) {
				this.respawn(i, r);
				continue;
			}
			this.px[i] = this.x[i];
			this.py[i] = this.y[i];
			this.x[i] = n.x;
			this.y[i] = n.y;
			this.speed[i] = Math.hypot(w.u, w.v);
			moved++;
		}
		return moved;
	}

	private respawn(i: number, r: Region): void {
		this.x[i] = this.px[i] = r.x0 + this.random() * r.side;
		this.y[i] = this.py[i] = r.y0 + this.random() * r.side;
		this.age[i] = 0;
		this.life[i] = MIN_LIFE_S + this.random() * (MAX_LIFE_S - MIN_LIFE_S);
		this.speed[i] = 0;
	}
}
