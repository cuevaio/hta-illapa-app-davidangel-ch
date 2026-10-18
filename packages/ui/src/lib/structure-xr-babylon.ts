import type { Scene, TransformNode } from "@babylonjs/core";
import type { BabylonTerrain } from "@hack-the-andes-project/terrain/babylon/types";
import type { LocalPoint } from "@hack-the-andes-project/terrain/types";

export interface StructureXrLabels {
	placeTable: string;
	undo: string;
	exit: string;
	error: string;
}

export interface StructureXrOptions {
	scene: Scene;
	terrain: BabylonTerrain;
	content: TransformNode;
	getFocus: () => LocalPoint | null;
	labels: StructureXrLabels;
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
