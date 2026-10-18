import type { SolverStats } from "../../solver/Solver";

export interface HudFrame {
	fps: number;
	/** Solver cost per step (ms), GPU timestamps when available. */
	stepMs: number | null;
	substeps: number;
	backend: string;
	resolution: number;
	renderScale: number;
}

/**
 * Relative mass error: (volume in domain − expected) / expected, where expected =
 * injected − removed by edits, so edit-induced changes are not mistaken for solver error.
 */
export function massError(stats: SolverStats): number {
	const expected = stats.injectedVolume - stats.editRemovedVolume;
	if (expected < 1) return 0;
	return (stats.volume - expected) / expected;
}

const fmt = (v: number, d = 1) =>
	v.toLocaleString("es", {
		maximumFractionDigits: d,
		minimumFractionDigits: d,
	});

/** Compact performance and conservation readout over the canvas. */
export class Hud {
	private readonly el: HTMLElement;
	private stats: SolverStats | null = null;
	private frame: HudFrame | null = null;
	private cursor: string | null = null;
	private notice: string | null = null;
	private context: string | null = null;

	constructor(container: HTMLElement) {
		this.el = document.createElement("div");
		this.el.className = "hud";
		this.el.setAttribute("aria-live", "off");
		container.append(this.el);
	}

	setFrame(f: HudFrame): void {
		this.frame = f;
		this.render();
	}

	setStats(s: SolverStats): void {
		this.stats = s;
		this.render();
	}

	setCursor(text: string | null): void {
		this.cursor = text;
		this.render();
	}

	/** Map context state of the terrain (src/map/mapContext.ts contextBadge). */
	setContext(text: string | null): void {
		this.context = text;
		this.render();
	}

	setNotice(text: string | null): void {
		this.notice = text;
		this.render();
	}

	private render(): void {
		const rows: string[] = [];
		const f = this.frame;
		if (f) {
			rows.push(
				`<b>${fmt(f.fps, 0)} fps</b> · solver ${f.stepMs === null ? "n/d" : `${fmt(f.stepMs, 2)} ms/paso`} · ${f.substeps} pasos/fotograma`,
			);
			rows.push(
				`${f.backend} · ${f.resolution}² celdas${f.renderScale > 1 ? ` · render 1/${fmt(f.renderScale, 1)}` : ""}`,
			);
		}
		const s = this.stats;
		if (s) {
			const err = massError(s);
			const errClass =
				Math.abs(err) < 1e-3 ? "ok" : Math.abs(err) < 1e-2 ? "warn" : "err";
			rows.push(`t = ${fmt(s.simTime, 1)} s · dt = ${fmt(s.dt * 1000, 1)} ms`);
			rows.push(
				`Volumen ${fmt(s.volume, 0)} m³ / inyectado ${fmt(s.injectedVolume, 0)} m³${s.editRemovedVolume > 0 ? ` / retirado por muros ${fmt(s.editRemovedVolume, 0)} m³` : ""}`,
			);
			rows.push(
				`Error de masa <span class="${errClass}">${(err * 100).toExponential(2)} %</span>`,
			);
			rows.push(
				`h máx ${fmt(s.maxDepth, 2)} m · h mín ${fmt(s.minDepth, 4)} m · v máx ${fmt(s.maxSpeed, 1)} m/s`,
			);
		}
		if (this.context) rows.push(this.context);
		if (this.cursor) rows.push(this.cursor);
		if (this.notice) rows.push(`<span class="warn">${this.notice}</span>`);
		this.el.innerHTML = rows.map((r) => `<div>${r}</div>`).join("");
	}
}
