export type Listener<T> = (state: T, prev: T) => void;

/**
 * Minimal observable store: the single source of truth shared by the HTML
 * panel, the VR panel, input tools and the simulation loop.
 */
export class Store<T extends object> {
	private state: T;
	private readonly listeners = new Set<Listener<T>>();

	constructor(initial: T) {
		this.state = initial;
	}

	get(): T {
		return this.state;
	}

	/** Shallow-merges `patch` (or the result of `fn(state)`) and notifies listeners. */
	set(patch: Partial<T> | ((s: T) => Partial<T>)): void {
		const prev = this.state;
		const p = typeof patch === "function" ? patch(prev) : patch;
		this.state = { ...prev, ...p };
		for (const l of this.listeners) l(this.state, prev);
	}

	subscribe(listener: Listener<T>): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Calls `fn` whenever `select(state)` changes (by reference, or by `equal` when given). */
	watch<S>(
		select: (s: T) => S,
		fn: (value: S, prev: S) => void,
		equal: (a: S, b: S) => boolean = Object.is,
	): () => void {
		return this.subscribe((s, p) => {
			const a = select(s);
			const b = select(p);
			if (!equal(a, b)) fn(a, b);
		});
	}
}
