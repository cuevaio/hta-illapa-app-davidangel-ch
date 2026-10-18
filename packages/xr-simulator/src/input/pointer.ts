export type Vec3 = [number, number, number];

/** World-space ray; `direction` is normalised. */
export interface Ray {
	origin: Vec3;
	direction: Vec3;
}

export type PointerPhase = "down" | "move" | "up" | "cancel";
export type PointerKind =
	| "mouse"
	| "touch"
	| "pen"
	| "xr-controller"
	| "xr-hand";

/**
 * Device-agnostic pointer sample. Mouse, touch, XR controllers and hands all
 * produce these, so tools are written once against rays.
 */
export interface PointerSample {
	/** Stable id per physical pointer (finger, controller, mouse). */
	id: string;
	kind: PointerKind;
	phase: PointerPhase;
	ray: Ray;
	/** True for the pointer that drives tools (first finger, main controller). */
	primary: boolean;
	/** Distance moved since `down`, in CSS px (screen) or metres (XR); lets tools tell taps from drags. */
	travel: number;
	/** Button/trigger/finger currently down (always true for `down`, false for `up`). */
	pressed: boolean;
	/**
	 * The gesture is reserved for editing tools (left mouse button while a tool is
	 * active, XR trigger). Touch drags belong to the camera; touch uses taps instead.
	 */
	toolGesture: boolean;
}

/** Screen pointers: a release within this many CSS px of the press counts as a tap/click. */
export const TAP_TRAVEL_PX = 10;

/** True when an `up` ends a tap or click rather than a drag. XR triggers always count. */
export function isTap(p: PointerSample): boolean {
	if (p.phase !== "up") return false;
	return (
		p.kind === "xr-controller" ||
		p.kind === "xr-hand" ||
		p.travel < TAP_TRAVEL_PX
	);
}

export type PointerListener = (sample: PointerSample) => void;

export interface PointerSource {
	subscribe(listener: PointerListener): () => void;
	dispose(): void;
}

/** Fan-in of several sources (screen + XR) behind one subscription. */
export class PointerHub implements PointerSource {
	private readonly listeners = new Set<PointerListener>();
	private readonly unsubs: (() => void)[] = [];

	add(source: PointerSource): void {
		this.unsubs.push(
			source.subscribe((s) =>
				this.listeners.forEach((l) => {
					l(s);
				}),
			),
		);
	}

	subscribe(listener: PointerListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	dispose(): void {
		this.unsubs.forEach((u) => {
			u();
		});
		this.listeners.clear();
	}
}
