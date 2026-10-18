import type {
	PointerKind,
	PointerListener,
	PointerPhase,
	PointerSource,
	Ray,
} from "./pointer";

export interface DomPointerOptions {
	/** Ancestor that receives the events in the capture phase, before Babylon's canvas listeners. */
	captureRoot: HTMLElement;
	/** Gestures for which this returns true on `pointerdown` are kept from the camera. */
	claim?: (e: PointerEvent) => boolean;
}

/**
 * Mouse, touch and pen through Pointer Events. Each event becomes a ray via
 * `toRay`, so tools never see screen coordinates. Claimed gestures (e.g. the
 * left mouse button while an editing tool is active) do not reach the camera.
 */
export class DomPointerSource implements PointerSource {
	private readonly listeners = new Set<PointerListener>();
	private readonly starts = new Map<number, { x: number; y: number }>();
	private readonly claimed = new Set<number>();
	private readonly canvas: HTMLCanvasElement;
	private readonly toRay: (x: number, y: number) => Ray;
	private readonly opts: DomPointerOptions;
	private readonly handlers: [string, (e: PointerEvent) => void][];

	constructor(
		canvas: HTMLCanvasElement,
		toRay: (x: number, y: number) => Ray,
		opts: DomPointerOptions,
	) {
		this.canvas = canvas;
		this.toRay = toRay;
		this.opts = opts;
		const on = (phase: PointerPhase) => (e: PointerEvent) =>
			this.handle(phase, e);
		this.handlers = [
			["pointerdown", on("down")],
			["pointermove", on("move")],
			["pointerup", on("up")],
			["pointercancel", on("cancel")],
		];
		for (const [type, fn] of this.handlers)
			opts.captureRoot.addEventListener(type, fn as EventListener, {
				capture: true,
			});
	}

	private handle(phase: PointerPhase, e: PointerEvent): void {
		const claimed = this.claimed.has(e.pointerId);
		const ownedByTool =
			claimed || (phase === "down" && this.opts.claim?.(e) === true);
		// Ignore the HTML panel and other overlays, unless a claimed gesture wandered over them.
		if (e.target !== this.canvas && !claimed) return;
		if (phase === "down" && ownedByTool) {
			this.claimed.add(e.pointerId);
			this.canvas.setPointerCapture?.(e.pointerId);
		}
		if (this.claimed.has(e.pointerId)) e.stopPropagation();
		if (phase === "up" || phase === "cancel") this.claimed.delete(e.pointerId);

		const rect = this.canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		if (phase === "down") this.starts.set(e.pointerId, { x, y });
		const start = this.starts.get(e.pointerId);
		const travel = start ? Math.hypot(x - start.x, y - start.y) : 0;
		if (phase === "up" || phase === "cancel") this.starts.delete(e.pointerId);
		const sample = {
			id: `${e.pointerType}-${e.pointerId}`,
			kind: (e.pointerType || "mouse") as PointerKind,
			phase,
			ray: this.toRay(x, y),
			primary: e.isPrimary,
			travel,
			pressed: phase === "down" || (phase === "move" && e.buttons !== 0),
			toolGesture: ownedByTool,
		};
		this.listeners.forEach((l) => {
			l(sample);
		});
	}

	subscribe(listener: PointerListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		for (const [type, fn] of this.handlers)
			this.opts.captureRoot.removeEventListener(type, fn as EventListener, {
				capture: true,
			});
		this.listeners.clear();
	}
}
