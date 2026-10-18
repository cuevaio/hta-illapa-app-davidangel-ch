import type { Scene, TransformNode } from "@babylonjs/core";
import type { XrSessionMember } from "@hack-the-andes-project/xr-simulator/viewer";
import type { LocalPoint, StructureTerrain } from "./structure-terrain";

export interface StructureXrLabels {
	placeTable: string;
	undo: string;
	exit: string;
	error: string;
}

export interface StructureXrOptions {
	scene: Scene;
	terrain: StructureTerrain;
	content: TransformNode;
	getFocus: () => LocalPoint | null;
	labels: StructureXrLabels;
	webgpu: boolean;
	join: (member: XrSessionMember) => Promise<void>;
	onUndo: () => void;
	onSupportChange: (supported: boolean) => void;
	onSessionChange: (active: boolean) => void;
	onError: (message: string) => void;
}

export interface StructureXrController {
	enter(): Promise<void>;
	exit(): Promise<void>;
	dispose(): void;
}
