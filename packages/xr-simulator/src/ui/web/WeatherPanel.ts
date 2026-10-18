import { pointLabel } from "../../map/overviewState";
import { CAPE_CATEGORIES, CAPE_NOTE } from "../../map/weather/cape";
import type { WeatherLayerId } from "../../map/weather/catalog";
import {
	cssGradient,
	legendTicks,
	TEMPERATURE_PALETTE,
	WIND_PALETTE,
} from "../../map/weather/palette";
import type { PointLine } from "../../map/weather/pointQuery";
import {
	RAIN_SCALES,
	type RainMode,
	rainGradient,
	rainLegendStops,
} from "../../map/weather/rain";
import type {
	WeatherController,
	WeatherSnapshot,
} from "../../map/weather/WeatherController";

/**
 * "Capas meteorológicas" (S8): toggles with observed/forecast badge, opacity and status, legends,
 * the forecast timeline (play / step) of the GFS layers, the provenance of every enabled layer,
 * the point query of the last clicked point and the attribution line (always visible while a
 * layer is on). Used over the Peru overview and over the simulator's map context.
 */

const LEGEND_TITLE: Record<WeatherLayerId, string> = {
	clouds: "Nubes (observado) — GOES-19 ABI",
	rain: "Precipitación (pronóstico) — GFS",
	lightning: "Rayos (observado) — GOES-19 GLM",
	cape: "Potencial convectivo (pronóstico) — GFS CAPE, J/kg",
	wind: "Viento a 10 m (pronóstico) — GFS, km/h",
	temperature: "Temperatura a 2 m (pronóstico) — GFS, °C",
};

const esc = (s: string) =>
	s.replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
	);

function legendHtml(id: WeatherLayerId, s: WeatherSnapshot): string {
	const bar = (gradient: string, ticks: string[]) =>
		`<div class="wx-bar" style="background:${gradient}"></div><div class="wx-ticks">${ticks.map((t) => `<span>${esc(t)}</span>`).join("")}</div>`;
	let body = "";
	if (id === "temperature")
		body = bar(
			cssGradient(TEMPERATURE_PALETTE),
			legendTicks(-10, 40, 10).map(String),
		);
	else if (id === "wind")
		body =
			bar(cssGradient(WIND_PALETTE), legendTicks(0, 100, 25).map(String)) +
			'<p class="wx-note">Partículas animadas, velocidad acelerada para leer el movimiento.</p>';
	else if (id === "rain") {
		const mode = s.rainMode;
		body =
			`<div class="peru-mode wx-rain-mode" role="group" aria-label="Precipitación">${(["rate", "accum"] as RainMode[]).map((m) => `<button type="button" data-rain="${m}" aria-pressed="${m === mode}">${RAIN_SCALES[m].label}</button>`).join("")}</div>` +
			bar(
				rainGradient(),
				rainLegendStops(mode).map((t) => t.label),
			) +
			'<p class="wx-note">Pronóstico del modelo, no lluvia observada.</p>';
	} else if (id === "cape") {
		body = `<div class="wx-swatches">${CAPE_CATEGORIES.map((c) => `<span><i style="background:rgb(${c.color.join(" ")})"></i>${c.label} ≥ ${c.min.toLocaleString("es")}</span>`).join("")}</div><p class="wx-note">${esc(CAPE_NOTE)}</p>`;
	} else if (id === "lightning") {
		body =
			'<div class="wx-bar" style="background:linear-gradient(to right, rgb(255 255 225), rgb(255 215 60) 17%, rgb(255 160 40) 50%, rgb(230 110 40 / 0.3))"></div><div class="wx-ticks"><span>ahora</span><span>10 min</span><span>30 min</span><span>60 min</span></div>' +
			(s.lightning
				? `<p class="wx-note">${esc(s.lightning.window)} · ${esc(s.lightning.count)}</p>`
				: "");
	} else
		body =
			'<p class="wx-note">Brillo = topes de nube (IR); transparencia = probabilidad de nube. Una imagen cada 10 min.</p>';
	return `<div class="wx-legend"><p class="wx-legend-title">${esc(LEGEND_TITLE[id])}</p>${body}</div>`;
}

export class WeatherPanel {
	readonly el: HTMLElement;
	private readonly notice: HTMLElement;
	private readonly list: HTMLElement;
	private readonly legends: HTMLElement;
	private readonly timeline: HTMLElement;
	private readonly slider: HTMLInputElement;
	private readonly timeText: HTMLElement;
	private readonly playBtn: HTMLButtonElement;
	private readonly pointBox: HTMLElement;
	private readonly provenance: HTMLElement;
	private readonly provList: HTMLElement;
	private readonly attribution: HTMLElement;
	private readonly rows = new Map<
		WeatherLayerId,
		{ box: HTMLInputElement; range: HTMLInputElement; status: HTMLElement }
	>();
	private point: { lon: number; lat: number; height: number | null } | null =
		null;
	private pointQuery = 0;
	private queriedKey = "";
	private legendKey = "";
	private provKey = "";

	constructor(
		private readonly weather: WeatherController,
		className = "",
	) {
		this.el = document.createElement("section");
		this.el.className = `weather-panel ${className}`.trim();
		this.el.setAttribute("aria-label", "Capas meteorológicas");
		// Collapsed on phones and over the simulator (it shares the screen with the simulation UI).
		const compact =
			className.includes("weather-sim") ||
			(typeof matchMedia !== "undefined" &&
				matchMedia("(max-width: 700px)").matches);
		this.el.innerHTML = `
      <details class="wx-main"${compact ? "" : " open"}>
        <summary>Capas meteorológicas</summary>
        <p class="wx-notice" role="status" hidden></p>
        <ul class="wx-layers"></ul>
        <div class="wx-timeline" hidden>
          <div class="wx-time-row">
            <button type="button" data-step="-1" aria-label="Tiempo anterior">◀</button>
            <button type="button" class="wx-play" aria-label="Reproducir">▶︎ Reproducir</button>
            <button type="button" data-step="1" aria-label="Tiempo siguiente">▶</button>
          </div>
          <input type="range" min="0" max="0" step="1" value="0" aria-label="Tiempo del pronóstico">
          <p class="wx-time"></p>
        </div>
        <div class="wx-legends"></div>
        <div class="wx-point" hidden></div>
        <details class="wx-prov" hidden><summary>Procedencia de los datos</summary><div class="wx-prov-list"></div></details>
      </details>
      <p class="wx-attribution" hidden></p>`;
		this.notice = this.el.querySelector(".wx-notice")!;
		this.list = this.el.querySelector(".wx-layers")!;
		this.legends = this.el.querySelector(".wx-legends")!;
		this.timeline = this.el.querySelector(".wx-timeline")!;
		this.slider = this.timeline.querySelector("input")!;
		this.timeText = this.timeline.querySelector(".wx-time")!;
		this.playBtn = this.timeline.querySelector(".wx-play")!;
		this.pointBox = this.el.querySelector(".wx-point")!;
		this.provenance = this.el.querySelector(".wx-prov")!;
		this.provList = this.el.querySelector(".wx-prov-list")!;
		this.attribution = this.el.querySelector(".wx-attribution")!;
		this.slider.oninput = () => weather.setTimeIndex(Number(this.slider.value));
		for (const b of this.timeline.querySelectorAll<HTMLButtonElement>(
			"[data-step]",
		))
			b.onclick = () => weather.step(Number(b.dataset.step));
		this.playBtn.onclick = () =>
			weather.setPlaying(!weather.snapshot().playing);
		this.legends.addEventListener("click", (e) => {
			const b = (e.target as HTMLElement).closest<HTMLButtonElement>(
				"[data-rain]",
			);
			if (b) weather.setRainMode(b.dataset.rain as RainMode);
		});
		this.buildRows();
		weather.onChange(() => this.render());
		this.render();
	}

	/** Point query of a clicked point (null clears it). */
	setPoint(
		p: { lon: number; lat: number; height: number | null } | null,
	): void {
		this.point = p;
		this.renderPoint();
	}

	private buildRows(): void {
		const s = this.weather.snapshot();
		let group: string | null = null;
		for (const l of s.layers) {
			if (l.group && l.group !== group) {
				const h = document.createElement("li");
				h.className = "wx-group";
				h.textContent = l.group;
				this.list.append(h);
			}
			group = l.group;
			const li = document.createElement("li");
			li.className = `wx-row${l.group ? " wx-sub" : ""}`;
			li.innerHTML = `
        <label><input type="checkbox"> ${esc(l.title)}</label>
        <span class="wx-badge wx-${l.kindLabel === "observado" ? "observed" : "forecast"}">${esc(l.kindLabel)}</span>
        <input type="range" min="0" max="1" step="0.05" value="${l.opacity}" aria-label="Opacidad de ${esc(l.title)}">
        <span class="wx-status" aria-live="polite"></span>`;
			const box = li.querySelector<HTMLInputElement>("input[type=checkbox]")!;
			const range = li.querySelector<HTMLInputElement>("input[type=range]")!;
			box.onchange = () => this.weather.setEnabled(l.id, box.checked);
			range.oninput = () => this.weather.setOpacity(l.id, Number(range.value));
			this.rows.set(l.id, {
				box,
				range,
				status: li.querySelector(".wx-status")!,
			});
			this.list.append(li);
		}
	}

	private render(): void {
		const s = this.weather.snapshot();
		this.notice.textContent =
			s.notice ??
			(s.backend === "loading"
				? "Conectando con el servicio meteorológico…"
				: "");
		this.notice.hidden = !this.notice.textContent;
		for (const l of s.layers) {
			const r = this.rows.get(l.id)!;
			r.box.checked = l.enabled;
			r.box.disabled = l.disabled;
			r.range.hidden = !l.enabled;
			if (document.activeElement !== r.range) r.range.value = String(l.opacity);
			r.status.textContent = l.statusText ?? "";
			r.status.hidden = !l.statusText;
		}
		const gfs = s.layers.some((l) => l.enabled && l.kindLabel === "pronóstico");
		this.timeline.hidden = !gfs || !s.times.length;
		this.slider.max = String(Math.max(0, s.times.length - 1));
		if (document.activeElement !== this.slider)
			this.slider.value = String(Math.max(0, s.timeIndex));
		this.timeText.textContent = s.timeLabel
			? `Válido ${s.timeLabel}${s.leadLabel ? ` · ${s.leadLabel}` : ""}`
			: "";
		this.playBtn.textContent = s.playing ? "❚❚ Pausa" : "▶︎ Reproducir";
		this.playBtn.setAttribute(
			"aria-label",
			s.playing ? "Pausar" : "Reproducir",
		);
		const enabled = s.layers.filter((l) => l.enabled).map((l) => l.id);
		const legendKey = `${enabled.join()}|${s.rainMode}|${s.lightning?.window}|${s.lightning?.count}`;
		if (legendKey !== this.legendKey) {
			this.legendKey = legendKey;
			this.legends.innerHTML = enabled.map((id) => legendHtml(id, s)).join("");
		}
		const provKey = JSON.stringify(s.provenance);
		if (provKey !== this.provKey) {
			this.provKey = provKey;
			this.provList.innerHTML = s.provenance
				.map(
					(p) => `
        <div class="wx-prov-entry">
          <p><strong>${esc(p.title)}</strong> <span class="wx-badge wx-${p.kindLabel === "observado" ? "observed" : "forecast"}">${esc(p.kindLabel)}</span></p>
          <p>${esc(p.time)}</p>
          <p>Fuente: ${esc(p.source)}</p>
          <p>Atribución: ${esc(p.attribution)}</p>
          ${p.notice ? `<p class="wx-prov-notice">${esc(p.notice)}</p>` : ""}
        </div>`,
				)
				.join("");
		}
		this.provenance.hidden = !s.provenance.length;
		this.attribution.textContent = s.attribution
			? `Datos meteorológicos: ${s.attribution}`
			: "";
		this.attribution.hidden = !s.attribution;
		this.renderPoint();
	}

	private renderPoint(): void {
		const p = this.point;
		const lines =
			p && this.weather.available ? this.weather.pointLines(p.lon, p.lat) : [];
		this.pointBox.hidden = !p || !lines.length;
		if (!p || !lines.length) return;
		this.showLines(p, lines);
		const snap = this.weather.snapshot();
		const key = `${p.lon},${p.lat},${snap.timeIndex},${snap.rainMode},${lines.map((l) => l.id).join()}`;
		if (lines.some((l) => l.text === "cargando…") && key !== this.queriedKey) {
			this.queriedKey = key;
			const q = ++this.pointQuery;
			void this.weather.queryPoint(p.lon, p.lat).then((full) => {
				if (q === this.pointQuery && this.point === p) this.showLines(p, full);
			});
		}
	}

	private showLines(
		p: { lon: number; lat: number; height: number | null },
		lines: PointLine[],
	): void {
		this.pointBox.innerHTML = `<p class="wx-legend-title">En el punto · ${esc(pointLabel(p))}</p>${lines.map((l) => `<p><strong>${esc(l.label)}:</strong> ${esc(l.text)}</p>`).join("")}`;
	}
}
