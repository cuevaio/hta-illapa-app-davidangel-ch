import {
	attributionLine,
	BACKEND_DOWN_NOTICE,
	type Catalog,
	CLOUD_FALLBACK_NOTICE,
	GFS_LAYERS,
	KIND_LABEL,
	layerDef,
	parseCatalog,
	WEATHER_LAYERS,
	type WeatherLayerId,
} from "./catalog";
import {
	CLOUD_POLL_MS,
	type CloudMeta,
	cloudUpdate,
	parseCloudMeta,
} from "./clouds";
import { colorCape, colorScalars } from "./composite";
import {
	decodeGridBands,
	type GridMeta,
	lonLatToMercator,
	type MercatorBounds,
	mercatorToGridUv,
	parseGridMeta,
	sampleGrid,
} from "./grid";
import {
	LIGHTNING_READOUT_KM,
	type LightningData,
	lightningSummary,
	parseLightning,
} from "./lightning";
import { type PointInputs, type PointLine, pointLines } from "./pointQuery";
import type { RainMode } from "./rain";
import {
	forecastLabel,
	formatAge,
	formatUtc,
	formatUtcClock,
	nearestIndex,
	stepIndex,
	type TimeEntry,
} from "./timeline";

/**
 * Weather client state (S8): catalog, forecast time selection, GFS frame loading and caching,
 * cloud and lightning polling, point query and backend-down handling. DOM- and GPU-free: the
 * UI reads `snapshot()` (and listens to `onChange`), the GPU side (WeatherGpu) reads `gpu`
 * whose parts carry version numbers. Never retries in a loop: the catalog is retried once a
 * minute while the backend is down, polls keep their own interval after a failure.
 */

export interface WeatherApi {
	catalog(): Promise<unknown>;
	meta(layer: string, time: string): Promise<unknown>;
	grid(layer: string, time: string): Promise<ArrayBuffer>;
	point(
		layer: string,
		lat: number,
		lon: number,
		time: string,
	): Promise<unknown>;
	lightning(): Promise<unknown>;
	clouds(): Promise<unknown>;
	cloudImage(path: string): Promise<Blob>;
}

export interface WeatherOptions {
	now?: () => number;
	/** Decoded GFS frames kept (each 256 × 349 × bands × 4 B). */
	cacheFrames?: number;
	/** Cloud image decode (resized for the profile); absent in tests. */
	decodeImage?: (blob: Blob) => Promise<ImageBitmap>;
}

export const CATALOG_RETRY_MS = 60_000;
const CATALOG_REFRESH_MS = 10 * 60_000;
const LIGHTNING_POLL_MS = 60_000;
const PLAY_INTERVAL_MS = 1000;

export type LayerStatus = "off" | "loading" | "ready" | "stale" | "error";

export interface LayerView {
	id: WeatherLayerId;
	title: string;
	kindLabel: string;
	group: string | null;
	enabled: boolean;
	disabled: boolean;
	opacity: number;
	status: LayerStatus;
	statusText: string | null;
}

export interface ProvenanceEntry {
	id: WeatherLayerId;
	title: string;
	kindLabel: string;
	source: string;
	attribution: string;
	time: string;
	notice: string | null;
}

export interface WeatherSnapshot {
	backend: "loading" | "ready" | "down";
	notice: string | null;
	layers: LayerView[];
	times: TimeEntry[];
	timeIndex: number;
	playing: boolean;
	/** Valid time of the selected forecast frame ("2026-10-18 09:00 UTC"), null without an axis. */
	timeLabel: string | null;
	/** "Pronóstico +3 h del ciclo …". */
	leadLabel: string | null;
	rainMode: RainMode;
	provenance: ProvenanceEntry[];
	/** Attribution of every enabled layer; null when none is on. */
	attribution: string | null;
	lightning: { window: string; count: string } | null;
}

/** A decoded GFS frame. */
export interface Frame {
	meta: GridMeta;
	bands: Float32Array[];
}

/** What the GPU side draws; each part's `version` changes when it must be re-uploaded. */
export interface WeatherGpuState {
	scalars: {
		version: number;
		rgba: Uint8Array | null;
		width: number;
		height: number;
		bounds: MercatorBounds | null;
	};
	cape: {
		version: number;
		rgba: Uint8Array | null;
		width: number;
		height: number;
		bounds: MercatorBounds | null;
		opacity: number;
	};
	wind: { version: number; frame: Frame | null; opacity: number };
	clouds: {
		version: number;
		image: ImageBitmap | null;
		meta: CloudMeta | null;
		opacity: number;
	};
	lightning: { version: number; data: LightningData | null; opacity: number };
}

interface LayerState {
	enabled: boolean;
	opacity: number;
	status: LayerStatus;
	error: string | null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class WeatherController {
	private catalog: Catalog | null = null;
	private backend: WeatherSnapshot["backend"] = "loading";
	private readonly layers = new Map<WeatherLayerId, LayerState>();
	private timeIndex = -1;
	private playing = false;
	private rainMode: RainMode = "rate";
	/** Decoded frames by `${backend}/${timeId}` (LRU: re-inserted on use). */
	private readonly cache = new Map<string, Frame>();
	private readonly inFlight = new Map<string, Promise<Frame>>();
	/** Frame drawn per GFS layer (may be an older time while the selected one loads). */
	private readonly shown = new Map<WeatherLayerId, Frame>();
	private cloudMeta: CloudMeta | null = null;
	private shownScan: string | null = null;
	private lightningData: LightningData | null = null;
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly listeners = new Set<() => void>();
	private disposed = false;
	private readonly now: () => number;
	private readonly cacheFrames: number;
	readonly gpu: WeatherGpuState = {
		scalars: { version: 0, rgba: null, width: 0, height: 0, bounds: null },
		cape: {
			version: 0,
			rgba: null,
			width: 0,
			height: 0,
			bounds: null,
			opacity: 0,
		},
		wind: { version: 0, frame: null, opacity: 0 },
		clouds: { version: 0, image: null, meta: null, opacity: 0 },
		lightning: { version: 0, data: null, opacity: 0 },
	};

	constructor(
		private readonly api: WeatherApi,
		private readonly options: WeatherOptions = {},
	) {
		this.now = options.now ?? Date.now;
		this.cacheFrames = options.cacheFrames ?? 24;
		for (const d of WEATHER_LAYERS)
			this.layers.set(d.id, {
				enabled: false,
				opacity: d.opacity,
				status: "off",
				error: null,
			});
	}

	/** Loads the catalog; on failure the layers stay disabled and it is retried once a minute. */
	async start(): Promise<void> {
		await this.loadCatalog();
	}

	onChange(cb: () => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	get available(): boolean {
		return this.backend === "ready";
	}

	get anyEnabled(): boolean {
		for (const l of this.layers.values()) if (l.enabled) return true;
		return false;
	}

	isEnabled(id: WeatherLayerId): boolean {
		return this.layers.get(id)!.enabled;
	}

	setEnabled(id: WeatherLayerId, on: boolean): void {
		const l = this.layers.get(id)!;
		if (on === l.enabled || (on && this.backend !== "ready")) return;
		l.enabled = on;
		l.error = null;
		l.status = on ? "loading" : "off";
		if (id === "clouds") {
			if (on) void this.pollClouds();
			else this.stopTimer("clouds");
		} else if (id === "lightning") {
			if (on) void this.pollLightning();
			else this.stopTimer("lightning");
		} else if (on) void this.ensureFrames();
		if (!on && id !== "clouds" && id !== "lightning") this.shown.delete(id);
		if (!this.gfsEnabled()) this.setPlaying(false);
		this.syncGpu();
		this.emit();
	}

	toggle(id: WeatherLayerId): void {
		this.setEnabled(id, !this.isEnabled(id));
	}

	setOpacity(id: WeatherLayerId, opacity: number): void {
		this.layers.get(id)!.opacity = Math.min(1, Math.max(0, opacity));
		this.syncGpu();
		this.emit();
	}

	setRainMode(mode: RainMode): void {
		if (mode === this.rainMode) return;
		this.rainMode = mode;
		this.syncGpu();
		this.emit();
	}

	setTimeIndex(i: number): void {
		const n = this.catalog?.times.length ?? 0;
		if (!n) return;
		const next = Math.min(n - 1, Math.max(0, Math.round(i)));
		if (next === this.timeIndex) return;
		this.timeIndex = next;
		void this.ensureFrames();
		this.emit();
	}

	step(delta: number): void {
		const n = this.catalog?.times.length ?? 0;
		this.setTimeIndex(stepIndex(this.timeIndex, n, delta));
	}

	setPlaying(on: boolean): void {
		if (on === this.playing || (on && !this.gfsEnabled())) return;
		this.playing = on;
		this.stopTimer("play");
		if (on) this.schedule("play", PLAY_INTERVAL_MS, () => this.playTick());
		this.emit();
	}

	/** Values at a point from the loaded grids (synchronous; 'loading' where the selected frame is not here yet). */
	pointInputs(lon: number, lat: number): PointInputs {
		const p: PointInputs = { now: this.now() };
		const time = this.currentTime();
		const frameAt = (id: WeatherLayerId) => {
			const f = this.shown.get(id);
			return f && time && f.meta.timeId === time.id ? f : null;
		};
		const at = (f: Frame, band: number) => {
			const m = lonLatToMercator(lon, lat);
			const { u, v } = mercatorToGridUv(f.meta.bounds, m.x, m.y);
			return sampleGrid(
				{
					width: f.meta.width,
					height: f.meta.height,
					bounds: f.meta.bounds,
					values: f.bands[band],
				},
				u,
				v,
			);
		};
		if (this.isEnabled("temperature")) {
			const f = frameAt("temperature");
			p.temperature = f ? at(f, 0) : "loading";
		}
		if (this.isEnabled("wind")) {
			const f = frameAt("wind");
			if (!f) p.wind = "loading";
			else {
				const u = at(f, bandIndex(f, "u", 0));
				const v = at(f, bandIndex(f, "v", 1));
				p.wind = u === null || v === null ? null : { u, v };
			}
		}
		if (this.isEnabled("rain")) {
			const f = frameAt("rain");
			p.rain = f
				? {
						value: {
							rate: at(f, bandIndex(f, "rate", 0)),
							accum: at(f, bandIndex(f, "accum", 1)),
						},
						mode: this.rainMode,
						issueTime: f.meta.accumSince ?? f.meta.issueTime,
					}
				: "loading";
		}
		if (this.isEnabled("cape")) {
			const f = frameAt("cape");
			p.cape = f ? at(f, 0) : "loading";
		}
		if (this.isEnabled("lightning")) {
			const d = this.lightningData;
			p.lightning = d
				? {
						summary: lightningSummary(d, lon, lat, LIGHTNING_READOUT_KM),
						radiusKm: LIGHTNING_READOUT_KM,
						windowMinutes: d.windowMinutes,
					}
				: "loading";
		}
		return p;
	}

	pointLines(lon: number, lat: number): PointLine[] {
		return pointLines(this.pointInputs(lon, lat));
	}

	/** Point query; layers whose grid is still loading are asked to the point endpoint for the selected time. */
	async queryPoint(lon: number, lat: number): Promise<PointLine[]> {
		const p = this.pointInputs(lon, lat);
		const time = this.currentTime();
		if (time) {
			const ask = async (id: WeatherLayerId) => {
				try {
					return (await this.api.point(
						layerDef(id).backend,
						lat,
						lon,
						time.id,
					)) as Record<string, unknown>;
				} catch {
					return null;
				}
			};
			const num = (v: unknown) =>
				typeof v === "number" && Number.isFinite(v) ? v : null;
			const jobs: Promise<void>[] = [];
			if (p.temperature === "loading")
				jobs.push(
					ask("temperature").then((r) => {
						p.temperature = r ? num(r.value) : null;
					}),
				);
			if (p.cape === "loading")
				jobs.push(
					ask("cape").then((r) => {
						p.cape = r ? num(r.value) : null;
					}),
				);
			if (p.wind === "loading")
				jobs.push(
					ask("wind").then((r) => {
						const u = r ? num(r.u) : null;
						const v = r ? num(r.v) : null;
						p.wind = u === null || v === null ? null : { u, v };
					}),
				);
			if (p.rain === "loading")
				jobs.push(
					ask("rain").then((r) => {
						const b =
							r && typeof r.bands === "object" && r.bands
								? (r.bands as Record<string, unknown>)
								: null;
						p.rain = b
							? {
									value: { rate: num(b.rate), accum: num(b.accum) },
									mode: this.rainMode,
									issueTime: Date.parse(String(r!.issueTime)),
								}
							: null;
					}),
				);
			await Promise.all(jobs);
		}
		return pointLines(p);
	}

	snapshot(): WeatherSnapshot {
		const ready = this.backend === "ready";
		const layers: LayerView[] = WEATHER_LAYERS.map((d) => {
			const l = this.layers.get(d.id)!;
			return {
				id: d.id,
				title: d.title,
				kindLabel: KIND_LABEL[d.kind],
				group: d.group,
				enabled: l.enabled,
				disabled: !ready,
				opacity: l.opacity,
				status: l.status,
				statusText: this.statusText(d.id, l),
			};
		});
		const time = this.currentTime();
		const issue = this.catalog?.entries.get("gfs-t2m")?.issueTime ?? null;
		const enabled = WEATHER_LAYERS.filter(
			(d) => this.layers.get(d.id)!.enabled,
		);
		const lightning =
			this.isEnabled("lightning") && this.lightningData
				? this.lightningLegend(this.lightningData)
				: null;
		return {
			backend: this.backend,
			notice: this.backend === "down" ? BACKEND_DOWN_NOTICE : null,
			layers,
			times: this.catalog?.times ?? [],
			timeIndex: this.timeIndex,
			playing: this.playing,
			timeLabel: time ? formatUtc(time.validTime) : null,
			leadLabel:
				time && issue !== null ? forecastLabel(time.validTime, issue) : null,
			rainMode: this.rainMode,
			provenance: enabled.map((d) => this.provenance(d.id)),
			attribution: attributionLine(
				enabled.map((d) => ({
					title: d.title,
					attribution: this.catalog?.entries.get(d.backend)?.attribution ?? "",
				})),
			),
			lightning,
		};
	}

	dispose(): void {
		this.disposed = true;
		for (const t of this.timers.values()) clearTimeout(t);
		this.timers.clear();
		this.listeners.clear();
	}

	// --- internals ---

	private emit(): void {
		for (const cb of this.listeners) cb();
	}

	private schedule(key: string, ms: number, fn: () => void): void {
		this.stopTimer(key);
		if (this.disposed) return;
		this.timers.set(
			key,
			setTimeout(() => {
				this.timers.delete(key);
				fn();
			}, ms),
		);
	}

	private stopTimer(key: string): void {
		const t = this.timers.get(key);
		if (t !== undefined) clearTimeout(t);
		this.timers.delete(key);
	}

	private async loadCatalog(): Promise<void> {
		try {
			const catalog = parseCatalog(await this.api.catalog());
			if (this.disposed) return;
			const times = catalog.times;
			const previous = this.currentTime();
			this.catalog = catalog;
			this.backend = "ready";
			// Keep the selected valid time across a refresh when it still exists, else nearest to now.
			const keep = previous
				? times.findIndex((t) => t.validTime === previous.validTime)
				: -1;
			this.timeIndex = keep >= 0 ? keep : nearestIndex(times, this.now());
			this.schedule(
				"catalog",
				CATALOG_REFRESH_MS,
				() => void this.loadCatalog(),
			);
			void this.ensureFrames();
		} catch (err) {
			if (this.disposed) return;
			console.warn("Weather backend unavailable:", message(err));
			// A refresh failure keeps the catalog already shown; without one the layers are off.
			if (!this.catalog) {
				this.backend = "down";
				for (const [id, l] of this.layers) {
					l.enabled = false;
					l.status = "off";
					if (id !== "clouds" && id !== "lightning") this.shown.delete(id);
				}
				this.stopTimer("clouds");
				this.stopTimer("lightning");
				this.setPlaying(false);
				this.syncGpu();
				this.schedule(
					"catalog",
					CATALOG_RETRY_MS,
					() => void this.loadCatalog(),
				);
			} else {
				this.schedule(
					"catalog",
					CATALOG_REFRESH_MS,
					() => void this.loadCatalog(),
				);
			}
		}
		this.emit();
	}

	private currentTime(): TimeEntry | null {
		return this.catalog?.times[this.timeIndex] ?? null;
	}

	private gfsEnabled(): boolean {
		return GFS_LAYERS.some((id) => this.isEnabled(id));
	}

	private playTick(): void {
		if (!this.playing) return;
		this.step(1);
		this.schedule("play", PLAY_INTERVAL_MS, () => this.playTick());
	}

	/** Requests the selected time of every enabled GFS layer (and the next one while playing). */
	private async ensureFrames(): Promise<void> {
		const time = this.currentTime();
		if (!time || !this.catalog) return;
		const next = this.playing
			? this.catalog.times[
					stepIndex(this.timeIndex, this.catalog.times.length, 1)
				]
			: null;
		const jobs = GFS_LAYERS.filter((id) => this.isEnabled(id)).map(
			async (id) => {
				const backend = layerDef(id).backend;
				try {
					const frame = await this.frame(backend, time.id);
					const l = this.layers.get(id)!;
					if (this.disposed || !l.enabled || this.currentTime()?.id !== time.id)
						return;
					this.shown.set(id, frame);
					l.status = "ready";
					l.error = null;
					this.syncGpu();
					this.emit();
					if (next) void this.frame(backend, next.id).catch(() => {});
				} catch (err) {
					const l = this.layers.get(id)!;
					if (this.disposed || !l.enabled || this.currentTime()?.id !== time.id)
						return;
					l.status = "error";
					l.error = message(err);
					this.emit();
				}
			},
		);
		if (jobs.length) {
			for (const id of GFS_LAYERS) {
				const l = this.layers.get(id)!;
				if (
					l.enabled &&
					this.shown.get(id)?.meta.timeId !== time.id &&
					l.status !== "error"
				)
					l.status = "loading";
			}
			this.emit();
		}
		await Promise.all(jobs);
	}

	private frame(backend: string, timeId: string): Promise<Frame> {
		const key = `${backend}/${timeId}`;
		const hit = this.cache.get(key);
		if (hit) {
			this.cache.delete(key);
			this.cache.set(key, hit);
			return Promise.resolve(hit);
		}
		const pending = this.inFlight.get(key);
		if (pending) return pending;
		const job = (async () => {
			const [metaJson, buffer] = await Promise.all([
				this.api.meta(backend, timeId),
				this.api.grid(backend, timeId),
			]);
			const meta = parseGridMeta(metaJson);
			if (!meta) throw new Error("metadatos de la rejilla no válidos");
			const frame = { meta, bands: decodeGridBands(buffer, meta) };
			this.cache.set(key, frame);
			while (this.cache.size > this.cacheFrames)
				this.cache.delete(this.cache.keys().next().value!);
			return frame;
		})();
		this.inFlight.set(key, job);
		void job.finally(() => this.inFlight.delete(key)).catch(() => {});
		return job;
	}

	private async pollClouds(): Promise<void> {
		if (!this.isEnabled("clouds")) return;
		const l = this.layers.get("clouds")!;
		try {
			const meta = parseCloudMeta(await this.api.clouds());
			if (!meta) throw new Error("metadatos de nubes no válidos");
			if (cloudUpdate(this.shownScan, meta) === "swap") {
				const blob = await this.api.cloudImage(meta.imagePath);
				const image = this.options.decodeImage
					? await this.options.decodeImage(blob)
					: null;
				if (!this.isEnabled("clouds")) {
					image?.close();
					return;
				}
				this.gpu.clouds.image = image;
				this.shownScan = meta.scanStart;
				this.gpu.clouds.version++;
			}
			this.cloudMeta = meta;
			l.status = "ready";
			l.error = null;
		} catch (err) {
			if (!this.isEnabled("clouds")) return;
			l.status = this.shownScan ? "stale" : "error";
			l.error = message(err);
		}
		this.syncGpu();
		this.emit();
		if (this.isEnabled("clouds"))
			this.schedule("clouds", CLOUD_POLL_MS, () => void this.pollClouds());
	}

	private async pollLightning(): Promise<void> {
		if (!this.isEnabled("lightning")) return;
		const l = this.layers.get("lightning")!;
		try {
			const data = parseLightning(await this.api.lightning());
			if (!data) throw new Error("datos de rayos no válidos");
			if (!this.isEnabled("lightning")) return;
			this.lightningData = data;
			this.gpu.lightning.data = data;
			this.gpu.lightning.version++;
			l.status = "ready";
			l.error = null;
		} catch (err) {
			if (!this.isEnabled("lightning")) return;
			l.status = this.lightningData ? "stale" : "error";
			l.error = message(err);
		}
		this.syncGpu();
		this.emit();
		if (this.isEnabled("lightning"))
			this.schedule(
				"lightning",
				LIGHTNING_POLL_MS,
				() => void this.pollLightning(),
			);
	}

	/** Recomputes what the GPU draws from the shown frames, toggles and opacities. */
	private syncGpu(): void {
		const g = this.gpu;
		const on = (id: WeatherLayerId) => this.isEnabled(id);
		const op = (id: WeatherLayerId) => this.layers.get(id)!.opacity;
		const t = on("temperature") ? this.shown.get("temperature") : undefined;
		const r = on("rain") ? this.shown.get("rain") : undefined;
		const base = t ?? r;
		if (base) {
			const sameGrid = (f: Frame | undefined) =>
				!!f &&
				f.meta.width === base.meta.width &&
				f.meta.height === base.meta.height;
			g.scalars.rgba = colorScalars(base.meta.width * base.meta.height, {
				temperature: t
					? { values: t.bands[0], opacity: op("temperature") }
					: undefined,
				rain:
					r && sameGrid(r)
						? {
								bands: {
									rate: r.bands[bandIndex(r, "rate", 0)],
									accum: r.bands[bandIndex(r, "accum", 1)],
								},
								mode: this.rainMode,
								opacity: op("rain"),
							}
						: undefined,
			});
			g.scalars.width = base.meta.width;
			g.scalars.height = base.meta.height;
			g.scalars.bounds = base.meta.bounds;
		} else {
			g.scalars.rgba = null;
		}
		g.scalars.version++;
		const c = on("cape") ? this.shown.get("cape") : undefined;
		if (c !== undefined || g.cape.rgba !== null) {
			g.cape.rgba = c ? colorCape(c.bands[0]) : null;
			g.cape.width = c?.meta.width ?? 0;
			g.cape.height = c?.meta.height ?? 0;
			g.cape.bounds = c?.meta.bounds ?? null;
			g.cape.version++;
		}
		g.cape.opacity = op("cape");
		const w = on("wind") ? (this.shown.get("wind") ?? null) : null;
		if (w !== g.wind.frame) {
			g.wind.frame = w;
			g.wind.version++;
		}
		g.wind.opacity = op("wind");
		g.clouds.meta = this.cloudMeta;
		g.clouds.opacity = on("clouds") && g.clouds.image ? op("clouds") : 0;
		g.lightning.opacity = on("lightning") ? op("lightning") : 0;
	}

	private statusText(id: WeatherLayerId, l: LayerState): string | null {
		if (this.backend !== "ready") return null;
		if (l.status === "loading") return "Cargando…";
		if (l.status === "error") return `No disponible: ${l.error ?? "error"}`;
		if (l.status === "stale")
			return `Último dato bueno; el servicio no respondió (${l.error ?? "error"})`;
		const entry = this.catalog?.entries.get(layerDef(id).backend);
		if (
			entry &&
			entry.status !== "ready" &&
			entry.status !== "stale" &&
			!l.enabled
		)
			return `Servicio: ${entry.status}`;
		return null;
	}

	private provenance(id: WeatherLayerId): ProvenanceEntry {
		const d = layerDef(id);
		const e = this.catalog?.entries.get(d.backend);
		const now = this.now();
		let time = "";
		let notice: string | null = null;
		if (d.kind === "forecast") {
			const t = this.currentTime();
			const issue = this.shown.get(id)?.meta.issueTime ?? e?.issueTime ?? null;
			time = t
				? `Válido ${formatUtc(t.validTime)}${issue !== null ? ` · ${forecastLabel(t.validTime, issue)}` : ""}`
				: "Sin tiempos de pronóstico";
			if (id === "cape") notice = "Potencial, no tormentas observadas.";
			if (id === "rain") notice = "Pronóstico del modelo, no lluvia observada.";
		} else if (id === "clouds") {
			const m = this.cloudMeta;
			const scan = m ? Date.parse(m.scanStart) : (e?.obsTime ?? null);
			time =
				scan !== null
					? `Escaneo ${formatUtc(scan)} (hace ${formatAge((now - scan) / 1000)})`
					: "Sin escaneo todavía";
			if (m?.fallback ?? e?.fallback) notice = CLOUD_FALLBACK_NOTICE;
		} else {
			const d2 = this.lightningData;
			time = d2
				? `Últimos ${Math.round(d2.windowMinutes)} min hasta ${formatUtcClock(d2.windowEnd)}`
				: "Sin datos todavía";
			if (
				d2?.coverageStart &&
				d2.coverageStart > d2.windowEnd - d2.windowMinutes * 60_000 + 60_000
			)
				notice = `Completando la ventana: datos completos desde ${formatUtcClock(d2.coverageStart)}.`;
		}
		return {
			id,
			title: d.title,
			kindLabel: KIND_LABEL[d.kind],
			source: e?.source ?? "",
			attribution: e?.attribution ?? "",
			time,
			notice,
		};
	}

	private lightningLegend(d: LightningData): { window: string; count: string } {
		return {
			window: `Últimos ${Math.round(d.windowMinutes)} min · hasta ${formatUtcClock(d.windowEnd)}`,
			count: d.count
				? `${d.count.toLocaleString("es")} destellos en el área del Perú`
				: `Ningún destello en los últimos ${Math.round(d.windowMinutes)} min sobre el área del Perú`,
		};
	}
}

function bandIndex(f: Frame, name: string, fallback: number): number {
	const i = f.meta.bands.findIndex((b) => b.name === name);
	return i < 0 ? fallback : i;
}
