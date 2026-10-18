/** Controls of the recording and the "result" mode, shared by the web timeline and the 3D panel. */
export interface ResultActions {
	toggleRecording(): void;
	/** Enters (true) or leaves (false) result mode; entering needs at least two recorded frames. */
	setResultMode(on: boolean): void;
	togglePlay(): void;
	step(direction: 1 | -1): void;
	seek(simTime: number): void;
	/** Simulated seconds per real second; negative plays backward. */
	setSpeed(speed: number): void;
}
