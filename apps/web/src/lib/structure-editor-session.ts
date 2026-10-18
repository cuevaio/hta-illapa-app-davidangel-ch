import {
	type Structure,
	structureInputSchema,
} from "@hack-the-andes-project/api/structure-schemas";
import type { SceneStructure } from "@hack-the-andes-project/ui/lib/structure-scene";
import { z } from "zod";
import { ENGINEERING_PENDING_STORAGE_PREFIX } from "../constants";
import {
	StructureHistory,
	type StructureHistoryStep,
} from "./structure-editor-history";
import {
	StructureSaveQueue,
	type StructureSaveState,
} from "./structure-editor-save-queue";
import { structureClient } from "./structure-queries";

export interface EditorStructure extends SceneStructure {
	updatedAt?: Date;
}
export interface StructureEditorSnapshot {
	structures: EditorStructure[];
	canUndo: boolean;
	canRedo: boolean;
	save: StructureSaveState;
}
export interface StructureEditorSessionOptions {
	userId: string;
	onInvalidEdit?: (id: string) => void;
	onRejected?: (id: string) => void;
	onCommit?: () => void;
}
export class StructureEditorSession {
	readonly history = new StructureHistory();
	readonly queue: StructureSaveQueue;
	private listeners = new Set<() => void>();
	private persistedIds = new Set<string>();
	private serverSnapshots = new Map<string, Structure>();
	private savedVersions = new Map<string, Date>();
	private deletedVersions = new Map<string, number>();
	private backupIds = new Set<string>();
	private storagePrefix: string;
	version = 0;
	private snapshot: StructureEditorSnapshot = {
		structures: [],
		canUndo: false,
		canRedo: false,
		save: {
			pendingIds: new Set(),
			rejectedIds: new Set(),
			failed: false,
			saving: false,
			isOnline: true,
			savedAt: null,
		},
	};
	constructor(private options: StructureEditorSessionOptions) {
		this.storagePrefix = `${ENGINEERING_PENDING_STORAGE_PREFIX}${options.userId}:`;
		this.queue = new StructureSaveQueue({
			persist: async (id, structure) => {
				if (!structure) {
					await structureClient.structures.delete({ id });
					this.persistedIds.delete(id);
					return null;
				}
				const saved = this.persistedIds.has(id)
					? await structureClient.structures.update(structure)
					: await structureClient.structures.create(structure);
				this.persistedIds.add(id);
				if (
					JSON.stringify(structureInputSchema.parse(saved)) !==
					JSON.stringify(structureInputSchema.parse(structure))
				)
					return structureClient.structures.update(structure);
				return saved;
			},
			onSaved: (id, saved, hasNewerEdit) => {
				this.version++;
				if (saved) {
					this.serverSnapshots.set(id, saved);
					this.savedVersions.set(id, saved.updatedAt);
					this.deletedVersions.delete(id);
					if (!hasNewerEdit) this.replace(id, saved);
				} else {
					this.serverSnapshots.delete(id);
					this.savedVersions.delete(id);
					this.deletedVersions.set(id, this.version);
				}
				this.publish();
			},
			onMissing: (id, structure, hasNewerEdit) => {
				this.persistedIds.delete(id);
				this.serverSnapshots.delete(id);
				this.savedVersions.delete(id);
				if (structure) this.deletedVersions.delete(id);
				else this.deletedVersions.set(id, ++this.version);
				if (structure || !hasNewerEdit) this.replace(id, null);
				if (structure) this.history.remove(id);
				this.publish();
			},
			onRejected: (id) => this.options.onRejected?.(id),
			onChange: (save) => {
				this.snapshot = { ...this.snapshot, save };
				this.backupPending();
				this.publish();
			},
		});
	}
	restorePending() {
		try {
			const restored = [];
			for (const key of Object.keys(localStorage)) {
				if (!key.startsWith(this.storagePrefix)) continue;
				try {
					const saved: unknown = JSON.parse(
						localStorage.getItem(key) ?? "null",
					);
					const parsed = z
						.object({
							structure: structureInputSchema.nullable(),
							persisted: z.boolean(),
							rejected: z.boolean().optional(),
						})
						.safeParse(saved);
					if (parsed.success)
						restored.push({
							id: key.slice(this.storagePrefix.length),
							...parsed.data,
						});
				} catch {}
			}
			for (const entry of restored) {
				this.backupIds.add(entry.id);
				if (entry.persisted) this.persistedIds.add(entry.id);
				this.replace(entry.id, entry.structure);
				this.queue.put(entry.id, entry.structure, entry.rejected);
				if (entry.rejected) this.options.onRejected?.(entry.id);
			}
		} catch {}
	}
	private backupPending() {
		try {
			const pending = this.queue.getPendingEntries();
			const pendingIds = new Set(pending.map((entry) => entry.id));
			for (const entry of pending)
				localStorage.setItem(
					`${this.storagePrefix}${entry.id}`,
					JSON.stringify({
						structure: entry.structure,
						persisted: this.persistedIds.has(entry.id),
						rejected: entry.rejected,
					}),
				);
			for (const id of this.backupIds)
				if (!pendingIds.has(id))
					localStorage.removeItem(`${this.storagePrefix}${id}`);
			this.backupIds = pendingIds;
		} catch {}
	}
	getSnapshot = () => this.snapshot;
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	mergeRemote(structures: Structure[], requestedVersion: number) {
		const remoteById = new Map(
			structures.map((structure) => [structure.id, structure]),
		);
		for (const [id, updatedAt] of this.savedVersions) {
			const remote = remoteById.get(id);
			if (remote && remote.updatedAt >= updatedAt)
				this.savedVersions.delete(id);
		}
		for (const [id, deletedVersion] of this.deletedVersions)
			if (!remoteById.has(id) && requestedVersion >= deletedVersion)
				this.deletedVersions.delete(id);
		const localById = new Map(
			this.snapshot.structures.map((structure) => [structure.id, structure]),
		);
		const protectedIds = new Set([
			...this.snapshot.save.pendingIds,
			...this.savedVersions.keys(),
			...this.deletedVersions.keys(),
		]);
		const merged: EditorStructure[] = [];
		for (const remote of structures) {
			const local = localById.get(remote.id);
			if (protectedIds.has(remote.id)) {
				if (local) merged.push(local);
				continue;
			}
			this.persistedIds.add(remote.id);
			if (
				!this.serverSnapshots.get(remote.id) ||
				(this.serverSnapshots.get(remote.id)?.updatedAt ?? remote.updatedAt) <=
					remote.updatedAt
			)
				this.serverSnapshots.set(remote.id, remote);
			merged.push(
				local?.updatedAt && local.updatedAt >= remote.updatedAt
					? local
					: remote,
			);
		}
		for (const local of this.snapshot.structures)
			if (!remoteById.has(local.id) && protectedIds.has(local.id))
				merged.push(local);
		if (
			merged.length === this.snapshot.structures.length &&
			merged.every(
				(structure, index) => structure === this.snapshot.structures[index],
			)
		)
			return;
		this.snapshot = { ...this.snapshot, structures: merged };
		this.publish();
	}
	commit(structure: SceneStructure, action: string) {
		const parsed = structureInputSchema.safeParse(structure);
		if (!parsed.success) {
			this.options.onInvalidEdit?.(structure.id);
			return;
		}
		const before =
			this.snapshot.structures.find(
				(existing) => existing.id === structure.id,
			) ?? null;
		if (before) {
			const previous = structureInputSchema.safeParse(before);
			if (
				previous.success &&
				JSON.stringify(previous.data) === JSON.stringify(parsed.data)
			)
				return;
		}
		this.options.onCommit?.();
		const step = this.history.push({ before, after: parsed.data, action });
		this.apply(structure.id, parsed.data);
		return step;
	}
	deleteStructure(id: string) {
		this.options.onCommit?.();
		this.history.remove(id);
		this.apply(id, null);
	}
	discard(id: string) {
		this.options.onCommit?.();
		this.history.remove(id);
		this.replace(id, this.serverSnapshots.get(id) ?? null);
		this.queue.discard(id);
	}
	replay(direction: "undo" | "redo"): StructureHistoryStep | undefined {
		const step =
			direction === "undo" ? this.history.undo() : this.history.redo();
		if (step) {
			this.options.onCommit?.();
			const target = direction === "undo" ? step.before : step.after;
			const id = (step.after ?? step.before)?.id;
			if (id) this.apply(id, target);
		}
		return step;
	}
	private apply(id: string, structure: SceneStructure | null) {
		this.version++;
		this.replace(id, structure);
		this.queue.put(id, structure);
	}
	private replace(id: string, structure: SceneStructure | null) {
		const existing = this.snapshot.structures.find(
			(candidate) => candidate.id === id,
		);
		const replacement: EditorStructure | null = structure
			? {
					...structure,
					updatedAt:
						"updatedAt" in structure && structure.updatedAt instanceof Date
							? structure.updatedAt
							: existing?.updatedAt,
				}
			: null;
		this.snapshot = {
			...this.snapshot,
			structures: replacement
				? existing
					? this.snapshot.structures.map((candidate) =>
							candidate.id === id ? replacement : candidate,
						)
					: [...this.snapshot.structures, replacement]
				: this.snapshot.structures.filter((candidate) => candidate.id !== id),
		};
	}
	private publish() {
		this.snapshot = {
			...this.snapshot,
			canUndo: this.history.canUndo,
			canRedo: this.history.canRedo,
		};
		for (const listener of this.listeners) listener();
	}
}
