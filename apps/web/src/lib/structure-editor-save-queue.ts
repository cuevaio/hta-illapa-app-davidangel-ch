import type { Structure } from "@hack-the-andes-project/api/structure-schemas";
import type { SceneStructure } from "@hack-the-andes-project/ui/lib/structure-scene";
import { ORPCError } from "@orpc/client";
import {
	AUTOSAVE_DEBOUNCE_MS,
	AUTOSAVE_RETRY_BASE_MS,
	AUTOSAVE_RETRY_MAX_MS,
	AUTOSAVE_RETRY_MULTIPLIER_RATIO,
	ENGINEERING_SERVER_ERROR_STATUS_MIN,
} from "../constants";

interface SaveEntry {
	id: string;
	structure: SceneStructure | null;
	dueAt: number;
	retryDelayMs: number;
	failed: boolean;
	rejected: boolean;
}

export interface StructureSaveState {
	pendingIds: Set<string>;
	rejectedIds: Set<string>;
	failed: boolean;
	saving: boolean;
	isOnline: boolean;
	savedAt: Date | null;
}

export interface StructureSaveQueueOptions {
	persist: (
		id: string,
		structure: SceneStructure | null,
	) => Promise<Structure | null>;
	onSaved: (
		id: string,
		structure: Structure | null,
		hasNewerEdit: boolean,
	) => void;
	onMissing: (
		id: string,
		structure: SceneStructure | null,
		hasNewerEdit: boolean,
	) => void;
	onRejected: (id: string) => void;
	onChange: (state: StructureSaveState) => void;
}

export class StructureSaveQueue {
	private entries = new Map<string, SaveEntry>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private inFlight: Promise<boolean> | null = null;
	private activeId: string | null = null;
	private savedAt: Date | null = null;
	private isOnline = true;
	constructor(private options: StructureSaveQueueOptions) {}
	get hasPending() {
		return Boolean(this.entries.size || this.inFlight);
	}
	getPendingEntries() {
		return [...this.entries.values()].map(({ id, structure, rejected }) => ({
			id,
			structure,
			rejected,
		}));
	}
	put(id: string, structure: SceneStructure | null, rejected = false) {
		this.entries.set(id, {
			id,
			structure: structuredClone(structure),
			rejected,
			dueAt: Date.now() + AUTOSAVE_DEBOUNCE_MS,
			retryDelayMs: AUTOSAVE_RETRY_BASE_MS,
			failed: false,
		});
		this.publish();
		this.schedule();
	}
	discard(id: string) {
		this.entries.delete(id);
		this.publish();
		this.schedule();
	}
	setOnline(isOnline: boolean) {
		if (this.isOnline === isOnline) return;
		this.isOnline = isOnline;
		if (isOnline) this.retry();
		else clearTimeout(this.timer);
		this.publish();
	}
	retry() {
		for (const entry of this.entries.values())
			if (!entry.rejected) entry.dueAt = Date.now();
		this.schedule();
	}
	async flush(): Promise<boolean> {
		clearTimeout(this.timer);
		if (this.inFlight) await this.inFlight;
		if (!this.isOnline) return !this.hasPending;
		for (const entry of this.entries.values())
			if (!entry.rejected) entry.dueAt = Date.now();
		while ([...this.entries.values()].some((entry) => !entry.rejected))
			if (!(await this.runNext())) return false;
		return !this.hasPending;
	}
	private publish() {
		const pendingIds = new Set(this.entries.keys());
		if (this.activeId) pendingIds.add(this.activeId);
		this.options.onChange({
			pendingIds,
			rejectedIds: new Set(
				[...this.entries.values()]
					.filter((entry) => entry.rejected)
					.map((entry) => entry.id),
			),
			failed: [...this.entries.values()].some(
				(entry) => entry.failed || entry.rejected,
			),
			saving: Boolean(this.inFlight || this.activeId),
			isOnline: this.isOnline,
			savedAt: this.savedAt,
		});
	}
	private schedule() {
		clearTimeout(this.timer);
		const pending = [...this.entries.values()].filter(
			(entry) => !entry.rejected,
		);
		if (this.inFlight || !this.isOnline || !pending.length) return;
		const earliest = Math.min(...pending.map((entry) => entry.dueAt));
		this.timer = setTimeout(
			() => {
				void this.runNext();
			},
			Math.max(0, earliest - Date.now()),
		);
	}
	private runNext(): Promise<boolean> {
		if (this.inFlight) return this.inFlight;
		const entry = [...this.entries.values()]
			.filter((candidate) => !candidate.rejected)
			.sort((first, second) => first.dueAt - second.dueAt)[0];
		if (!entry || !this.isOnline) return Promise.resolve(false);
		this.activeId = entry.id;
		this.inFlight = this.options
			.persist(entry.id, entry.structure)
			.then((saved) => {
				const hasNewerEdit = this.entries.get(entry.id) !== entry;
				if (!hasNewerEdit) this.entries.delete(entry.id);
				this.savedAt = new Date();
				this.options.onSaved(entry.id, saved, hasNewerEdit);
				return true;
			})
			.catch((error: unknown) => {
				const latest = this.entries.get(entry.id);
				if (error instanceof ORPCError && error.code === "NOT_FOUND") {
					const hasNewerEdit = latest !== entry;
					if (entry.structure || !hasNewerEdit) this.entries.delete(entry.id);
					this.options.onMissing(entry.id, entry.structure, hasNewerEdit);
					return true;
				}
				if (latest) {
					if (
						error instanceof ORPCError &&
						error.status < ENGINEERING_SERVER_ERROR_STATUS_MIN
					) {
						if (latest !== entry) return true;
						latest.rejected = true;
						this.options.onRejected(entry.id);
					} else {
						latest.failed = true;
						latest.dueAt = Date.now() + entry.retryDelayMs;
						latest.retryDelayMs = Math.min(
							entry.retryDelayMs * AUTOSAVE_RETRY_MULTIPLIER_RATIO,
							AUTOSAVE_RETRY_MAX_MS,
						);
					}
				}
				return false;
			})
			.finally(() => {
				this.inFlight = null;
				this.activeId = null;
				this.publish();
				this.schedule();
			});
		this.publish();
		return this.inFlight;
	}
}
