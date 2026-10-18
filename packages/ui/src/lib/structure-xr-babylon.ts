import type { Scene, TransformNode } from "@babylonjs/core";
import type { XrSessionMember } from "@hack-the-andes-project/xr-simulator/viewer";
import type { LocalPoint, StructureTerrain } from "./structure-terrain";

export interface StructureXrLabels {
	placeTable: string;
	undo: string;
	exit: string;
	error: string;
	backToMap: string;
}

export interface StructureXrOptions {
	scene: Scene;
	terrain: StructureTerrain;
	content: TransformNode;
	getFocus: () => LocalPoint | null;
	labels: StructureXrLabels;
	webgpu: boolean;
	join: (member: XrSessionMember) => Promise<void>;
	/** "Volver al mapa del Perú" is offered in the panel while this holds (VR shared session). */
	mapReachable: () => boolean;
	onBackToMap: () => void;
	onUndo: () => void;
	onSupportChange: (supported: boolean) => void;
	onSessionChange: (active: boolean) => void;
	onError: (message: string) => void;
}

export interface StructureXrController {
	/** The experience the viewer's shared session hands around; null when XR is unavailable. */
	readonly member: XrSessionMember | null;
	/**
	 * AR places the maquette on a real surface; VR (from the viewer's Peru map) in front of the
	 * viewer. `share` is false while adopting the viewer's running session in a hand-over.
	 */
	enter(mode?: XRSessionMode, share?: boolean): Promise<void>;
	exit(): Promise<void>;
	dispose(): void;
}
