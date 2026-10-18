import type { SceneStructure } from "@hack-the-andes-project/ui/lib/structure-scene";
import { ENGINEERING_MAX_UNDO_STEPS_COUNT } from "../constants";

export interface StructureHistoryStep {
	before: SceneStructure | null;
	after: SceneStructure | null;
	action: string;
}

export class StructureHistory {
	private past: StructureHistoryStep[] = [];
	private future: StructureHistoryStep[] = [];

	get canUndo() {
		return Boolean(this.past.length);
	}
	get canRedo() {
		return Boolean(this.future.length);
	}

	push(step: StructureHistoryStep) {
		const storedStep = structuredClone(step);
		this.past.push(storedStep);
		if (this.past.length > ENGINEERING_MAX_UNDO_STEPS_COUNT) this.past.shift();
		this.future = [];
		return storedStep;
	}

	undo() {
		const step = this.past.pop();
		if (step) this.future.push(step);
		return step;
	}

	redo() {
		const step = this.future.pop();
		if (step) this.past.push(step);
		return step;
	}

	remove(structureId: string) {
		this.past = this.past.filter(
			(step) => (step.after ?? step.before)?.id !== structureId,
		);
		this.future = this.future.filter(
			(step) => (step.after ?? step.before)?.id !== structureId,
		);
	}

	isTop(step: StructureHistoryStep) {
		return this.past.at(-1) === step;
	}
}
