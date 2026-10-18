import { EARTH_CIRCUMFERENCE, lonLatToWorld, worldToLonLat } from '../tileMath';
import { mercatorBoxToWorld, type WorldRect } from './grid';
import { clusterFlashes, clusterMode, lightningAgeStyle, pulsePhase, type FlashCell, type LightningData } from './lightning';
import { paletteColor, WIND_PALETTE } from './palette';
import { regionMeters } from './region';
import { animationSpeedFactor, ParticleField, type Region } from './wind';
import type { Frame } from './WeatherController';

/**
 * Canvas 2D painter of the overlay texture (S8): animated wind trails (CPU particles following
 * the GFS u/v field) and lightning markers fading by age, both in the overlay region of the
 * Web Mercator unit square; the terrain shader drapes the result, so marks lie exactly on the
 * rendered relief for every LOD state. Budgeted per profile (particles, canvas side).
 */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const FADE_HZ = 15;
const TRAIL_HALF_LIFE_S = 0.35;
/** Trail colour buckets (km/h) for batched strokes. */
const BUCKETS = [5, 15, 27, 42, 60, 85, 110];

function canvas(size: number): OffscreenCanvas | HTMLCanvasElement {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
}

export class OverlayPainter {
  readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  private readonly trails: OffscreenCanvas | HTMLCanvasElement;
  private readonly ctx: Ctx;
  private readonly tctx: Ctx;
  private readonly particles: ParticleField;
  private region: Region | null = null;
  private fadeAcc = 0;
  private windBox: WorldRect | null = null;
  private windFrame: Frame | null = null;
  private clusters: { key: string; cells: FlashCell[] } | null = null;
  private readonly colors = BUCKETS.map((k) => {
    const c = paletteColor(WIND_PALETTE, k);
    return `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;
  });

  constructor(readonly size: number, particleCount: number) {
    this.canvas = canvas(size);
    this.trails = canvas(size);
    this.ctx = this.canvas.getContext('2d') as Ctx;
    this.tctx = this.trails.getContext('2d') as Ctx;
    this.particles = new ParticleField(particleCount);
  }

  get currentRegion(): Region | null {
    return this.region;
  }

  /** New region (or wind frame): trails restart from scratch. */
  setRegion(r: Region): void {
    if (this.region && r.x0 === this.region.x0 && r.y0 === this.region.y0 && r.side === this.region.side) return;
    this.region = r;
    this.tctx.clearRect(0, 0, this.size, this.size);
    this.particles.respawnAll(r);
    this.clusters = null;
  }

  setWind(frame: Frame | null): void {
    if (frame === this.windFrame) return;
    this.windFrame = frame;
    this.windBox = frame ? mercatorBoxToWorld(frame.meta.bounds) : null;
  }

  clearTrails(): void {
    this.tctx.clearRect(0, 0, this.size, this.size);
  }

  /** Advances the particles `dt` s and draws their new segments; fades the old trails. */
  stepWind(dt: number, opacity: number): void {
    const r = this.region;
    const f = this.windFrame;
    const box = this.windBox;
    if (!r || !f || !box) return;
    const t = this.tctx;
    this.fadeAcc += dt;
    if (this.fadeAcc >= 1 / FADE_HZ) {
      const k = 1 - 0.5 ** (this.fadeAcc / TRAIL_HALF_LIFE_S);
      this.fadeAcc = 0;
      t.globalCompositeOperation = 'destination-out';
      t.fillStyle = `rgba(0,0,0,${k.toFixed(3)})`;
      t.fillRect(0, 0, this.size, this.size);
      t.globalCompositeOperation = 'source-over';
    }
    const w = f.meta.width;
    const h = f.meta.height;
    const iu = f.meta.bands.findIndex((b) => b.name === 'u');
    const iv = f.meta.bands.findIndex((b) => b.name === 'v');
    const U = f.bands[iu < 0 ? 0 : iu];
    const V = f.bands[iv < 0 ? 1 : iv];
    const sample = (x: number, y: number) => {
      const fx = ((x - box.x0) / box.w) * w - 0.5;
      const fy = ((y - box.y0) / box.h) * h - 0.5;
      if (fx < 0 || fy < 0 || fx > w - 1 || fy > h - 1) return null;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, w - 1);
      const y1 = Math.min(y0 + 1, h - 1);
      const tx = fx - x0;
      const ty = fy - y0;
      const a = y0 * w + x0, b = y0 * w + x1, c = y1 * w + x0, d = y1 * w + x1;
      const u = (U[a] * (1 - tx) + U[b] * tx) * (1 - ty) + (U[c] * (1 - tx) + U[d] * tx) * ty;
      const v = (V[a] * (1 - tx) + V[b] * tx) * (1 - ty) + (V[c] * (1 - tx) + V[d] * tx) * ty;
      return Number.isFinite(u) && Number.isFinite(v) ? { u, v } : null;
    };
    const p = this.particles;
    p.step(r, Math.min(dt, 0.1), sample, animationSpeedFactor(regionMeters(r)));
    const s = this.size / r.side;
    t.globalAlpha = opacity;
    t.lineWidth = Math.max(1, this.size / 640);
    t.lineCap = 'round';
    for (let b = 0; b < BUCKETS.length; b++) {
      const lo = b === 0 ? -1 : (BUCKETS[b - 1] + BUCKETS[b]) / 2;
      const hi = b === BUCKETS.length - 1 ? Infinity : (BUCKETS[b] + BUCKETS[b + 1]) / 2;
      t.beginPath();
      let any = false;
      for (let i = 0; i < p.count; i++) {
        const kmh = p.speed[i] * 3.6;
        if (p.speed[i] === 0 || kmh <= lo || kmh > hi) continue;
        t.moveTo((p.px[i] - r.x0) * s, (p.py[i] - r.y0) * s);
        t.lineTo((p.x[i] - r.x0) * s, (p.y[i] - r.y0) * s);
        any = true;
      }
      if (any) {
        t.strokeStyle = this.colors[b];
        t.stroke();
      }
    }
    t.globalAlpha = 1;
  }

  /** Overlay = wind trails + lightning markers (redrawn each call). */
  compose(lightning: LightningData | null, lightningOpacity: number, windOn: boolean, nowMs: number): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.size, this.size);
    if (windOn) c.drawImage(this.trails as CanvasImageSource, 0, 0);
    const r = this.region;
    if (!r || !lightning || lightningOpacity <= 0) return;
    const px = this.size / 1024;
    const windowS = lightning.windowMinutes * 60;
    const meters = regionMeters(r);
    const mode = clusterMode(meters);
    const s = this.size / r.side;
    const toCanvas = (lon: number, lat: number) => {
      const w = lonLatToWorld(lon, lat);
      return [(w.x - r.x0) * s, (w.y - r.y0) * s] as const;
    };
    c.globalAlpha = lightningOpacity;
    if (mode.mode === 'clusters') {
      const key = `${lightning.windowEnd}/${r.x0}/${r.y0}/${r.side}`;
      if (this.clusters?.key !== key) this.clusters = { key, cells: clusterFlashes(lightning, mode.cellMeters) };
      c.font = `bold ${Math.round(13 * px * 1.6)}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (const cell of this.clusters.cells) {
        // Centroid in mercator metres → unit square.
        const x = (cell.x / EARTH_CIRCUMFERENCE + 0.5 - r.x0) * s;
        const y = (0.5 - cell.y / EARTH_CIRCUMFERENCE - r.y0) * s;
        if (x < -40 || y < -40 || x > this.size + 40 || y > this.size + 40) continue;
        const st = lightningAgeStyle((nowMs - cell.latest) / 1000, windowS);
        if (st.alpha <= 0) continue;
        const radius = (5 + Math.sqrt(cell.count) * 2.2) * px * 1.6;
        c.beginPath();
        c.arc(x, y, radius, 0, Math.PI * 2);
        c.fillStyle = `rgba(${st.rgb[0]},${st.rgb[1]},${st.rgb[2]},${(0.35 + 0.55 * st.alpha).toFixed(3)})`;
        c.fill();
        c.lineWidth = 1.5 * px;
        c.strokeStyle = 'rgba(40,20,0,0.8)';
        c.stroke();
        if (radius > 9 * px) {
          c.fillStyle = '#1a1205';
          c.fillText(cell.count >= 1000 ? `${Math.round(cell.count / 100) / 10}k` : String(cell.count), x, y);
        }
      }
    } else {
      for (let i = 0; i < lightning.count; i++) {
        const age = (nowMs - lightning.time[i]) / 1000;
        const st = lightningAgeStyle(age, windowS);
        if (st.alpha <= 0) continue;
        const [x, y] = toCanvas(lightning.lon[i], lightning.lat[i]);
        if (x < -20 || y < -20 || x > this.size + 20 || y > this.size + 20) continue;
        const color = `rgba(${st.rgb[0]},${st.rgb[1]},${st.rgb[2]},${st.alpha.toFixed(3)})`;
        const d = 2.6 * px * 1.6;
        c.fillStyle = color;
        c.beginPath();
        c.arc(x, y, d, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = color;
        c.lineWidth = 1.2 * px * 1.6;
        c.beginPath();
        c.moveTo(x - 2.2 * d, y);
        c.lineTo(x + 2.2 * d, y);
        c.moveTo(x, y - 2.2 * d);
        c.lineTo(x, y + 2.2 * d);
        c.stroke();
        const pulse = pulsePhase(age, nowMs);
        if (pulse > 0) {
          c.strokeStyle = `rgba(255,255,230,${(0.8 * pulse).toFixed(3)})`;
          c.beginPath();
          c.arc(x, y, d * (2 + 3 * (1 - pulse)), 0, Math.PI * 2);
          c.stroke();
        }
      }
    }
    c.globalAlpha = 1;
  }

  /** Lon/lat of the region centre (debug). */
  centre(): { lon: number; lat: number } | null {
    const r = this.region;
    return r ? worldToLonLat(r.x0 + r.side / 2, r.y0 + r.side / 2) : null;
  }
}
