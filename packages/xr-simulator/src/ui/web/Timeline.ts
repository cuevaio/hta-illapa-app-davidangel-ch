import type { ResultActions } from "../../playback/ResultActions";
import type { AppState } from "../../state/appState";
import type { Store } from "../../state/store";
import { type IconName, iconSvg } from "../icons";
import { syncRangeFill } from "./mayu";

const SPEEDS = [-60, -20, -5, 5, 20, 60];

/**
 * Recording and result-mode timeline above the toolbar. Live: record and open the result.
 * Result: step back, play/pause, step forward, scrub, speed (negative plays backward), back to live.
 */
export class Timeline {
	constructor(
		container: HTMLElement,
		store: Store<AppState>,
		actions: ResultActions,
	) {
		const bar = document.createElement("div");
		bar.className = "timeline";
		bar.setAttribute("role", "toolbar");
		bar.setAttribute("aria-label", "Grabación y resultado");
		const button = (icon: IconName, label: string, onClick: () => void) => {
			const b = document.createElement("button");
			b.type = "button";
			b.title = label;
			b.setAttribute("aria-label", label);
			b.innerHTML = `${iconSvg(icon)}<span>${label}</span>`;
			b.addEventListener("click", onClick);
			return b;
		};
		const setButton = (b: HTMLButtonElement, icon: IconName, label: string) => {
			b.innerHTML = `${iconSvg(icon)}<span>${label}</span>`;
			b.title = label;
			b.setAttribute("aria-label", label);
		};

		const record = button("record", "Grabar", () => actions.toggleRecording());
		const open = button("result", "Ver resultado", () =>
			actions.setResultMode(true),
		);
		const back = button("stepBack", "Fotograma anterior", () =>
			actions.step(-1),
		);
		const play = button("play", "Reproducir", () => actions.togglePlay());
		const fwd = button("stepForward", "Fotograma siguiente", () =>
			actions.step(1),
		);
		const live = button("live", "Volver al vivo", () =>
			actions.setResultMode(false),
		);
		[back, play, fwd].forEach((b) => {
			b.classList.add("icon-only");
		});
		const range = document.createElement("input");
		range.type = "range";
		range.step = "any";
		range.setAttribute("aria-label", "Tiempo del resultado");
		range.addEventListener("input", () => {
			syncRangeFill(range);
			actions.seek(Number(range.value));
		});
		const label = document.createElement("span");
		label.className = "timeline-time";
		const speed = document.createElement("select");
		speed.setAttribute("aria-label", "Velocidad de reproducción");
		for (const v of SPEEDS)
			speed.add(new Option(v < 0 ? `◀ ×${-v}` : `×${v}`, String(v)));
		speed.addEventListener("change", () =>
			actions.setSpeed(Number(speed.value)),
		);
		const resultGroup = document.createElement("div");
		resultGroup.className = "timeline-result";
		resultGroup.append(back, play, fwd, range, label, speed, live);
		bar.append(record, open, resultGroup);
		container.append(bar);

		const sync = (s: AppState) => {
			const r = s.result;
			const inResult = r.mode === "result";
			record.hidden = inResult;
			open.hidden = inResult;
			resultGroup.hidden = !inResult;
			record.classList.toggle("active", r.recording);
			setButton(
				record,
				r.recording ? "stop" : "record",
				r.recording
					? `Detener (${r.frames})`
					: r.frames
						? `Grabar (${r.frames})`
						: "Grabar",
			);
			open.disabled = r.frames < 2;
			setButton(
				play,
				r.playing ? "pause" : "play",
				r.playing ? "Pausar" : "Reproducir",
			);
			range.min = String(r.start);
			range.max = String(r.end);
			if (document.activeElement !== range) range.value = String(r.time);
			syncRangeFill(range);
			label.textContent = `t = ${r.time.toFixed(0)} / ${r.end.toFixed(0)} s`;
			speed.value = String(r.speed);
		};
		sync(store.get());
		store.subscribe(sync);
	}
}
