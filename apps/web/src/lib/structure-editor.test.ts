import type { Structure } from "@hack-the-andes-project/api/structure-schemas";
import type { SceneStructure } from "@hack-the-andes-project/ui/lib/structure-scene";
import { ORPCError } from "@orpc/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AUTOSAVE_DEBOUNCE_MS,
	AUTOSAVE_RETRY_BASE_MS,
	ENGINEERING_MAX_UNDO_STEPS_COUNT,
	ENGINEERING_PENDING_STORAGE_PREFIX,
} from "../constants";
import { StructureHistory } from "./structure-editor-history";
import { StructureEditorSession } from "./structure-editor-session";
import { structureClient } from "./structure-queries";

vi.mock("../constants", () => ({
	AUTOSAVE_DEBOUNCE_MS: 1000,
	AUTOSAVE_RETRY_BASE_MS: 2000,
	AUTOSAVE_RETRY_MAX_MS: 30000,
	AUTOSAVE_RETRY_MULTIPLIER_RATIO: 2,
	ENGINEERING_MAX_UNDO_STEPS_COUNT: 100,
	ENGINEERING_SERVER_ERROR_STATUS_MIN: 500,
	ENGINEERING_PENDING_STORAGE_PREFIX: "pending:",
}));
vi.mock("./structure-queries", () => ({
	structureClient: {
		structures: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
	},
}));

const original: SceneStructure = {
	id: "client-bridge",
	name: "Puente 1",
	status: "planned",
	notes: "",
	anchor: { lat: -11.84, lng: -76.39, elevationM: 2400 },
	template: {
		kind: "bridge",
		start: { x: 0, y: 0, z: 0 },
		end: { x: 60, y: 0, z: 0 },
		deckWidthM: 10,
		pierCount: 2,
		deckMaterial: "concrete",
	},
	elements: [],
};
const userId = "engineer-a";
const backupKey = `${ENGINEERING_PENDING_STORAGE_PREFIX}${userId}:${original.id}`;
let storage: Record<string, string>;
let persisted: Map<string, Structure>;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-18T12:00:00Z"));
	vi.resetAllMocks();
	storage = {};
	persisted = new Map();
	vi.stubGlobal(
		"localStorage",
		Object.defineProperties(storage, {
			getItem: { value: (key: string) => storage[key] ?? null },
			setItem: {
				value: (key: string, value: string) => {
					storage[key] = value;
				},
			},
			removeItem: {
				value: (key: string) => {
					delete storage[key];
				},
			},
		}),
	);
	vi.mocked(structureClient.structures.create).mockImplementation(
		async (fields) => {
			const existing = persisted.get(fields.id);
			if (existing) return structuredClone(existing);
			const created = {
				...fields,
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			persisted.set(created.id, structuredClone(created));
			return created;
		},
	);
	vi.mocked(structureClient.structures.update).mockImplementation(
		async (fields) => {
			const existing = persisted.get(fields.id);
			if (!existing) throw new ORPCError("NOT_FOUND");
			const updated = {
				...fields,
				createdAt: existing.createdAt,
				updatedAt: new Date(),
			};
			persisted.set(updated.id, structuredClone(updated));
			return updated;
		},
	);
	vi.mocked(structureClient.structures.delete).mockImplementation(
		async ({ id }) => {
			if (!persisted.delete(id)) throw new ORPCError("NOT_FOUND");
			return { id };
		},
	);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function reloadSession(sessionUserId = userId) {
	const session = new StructureEditorSession({ userId: sessionUserId });
	session.mergeRemote(
		structuredClone([...persisted.values()]),
		session.version,
	);
	session.restorePending();
	return session;
}

async function createSavedSession() {
	const session = new StructureEditorSession({ userId });
	session.commit(original, "create");
	await session.queue.flush();
	return session;
}

describe("bounded undo history", () => {
	it("records immutable snapshots and identifies only the current top step", () => {
		const history = new StructureHistory();
		const changed = { ...original, notes: "edit" };
		const step = history.push({
			before: original,
			after: changed,
			action: "notes",
		});
		changed.notes = "outside mutation";
		expect(history.isTop(step)).toBe(true);
		expect(history.undo()?.after?.notes).toBe("edit");
		expect(history.isTop(step)).toBe(false);
		expect(history.redo()).toBe(step);
		history.push({ before: original, after: original, action: "new step" });
		expect(history.isTop(step)).toBe(false);
	});
	it("caps snapshots and clears redo on the next commit", () => {
		const history = new StructureHistory();
		for (let index = 0; index <= ENGINEERING_MAX_UNDO_STEPS_COUNT; index++)
			history.push({
				before: original,
				after: original,
				action: String(index),
			});
		let undoCount = 0;
		while (history.undo()) undoCount++;
		expect(undoCount).toBe(ENGINEERING_MAX_UNDO_STEPS_COUNT);
		history.push({ before: null, after: original, action: "new" });
		expect(history.canRedo).toBe(false);
	});
});

describe("stable identity, undo and recovery", () => {
	it("saves the client id without changing the selected entity identity", async () => {
		const session = await createSavedSession();
		expect(structureClient.structures.create).toHaveBeenCalledWith(original);
		expect(session.getSnapshot().structures[0]?.id).toBe(original.id);
		expect(persisted.size).toBe(1);
		expect(storage[backupKey]).toBeUndefined();
	});
	it("deletes after undo and reload, and recreates the same client id on redo", async () => {
		const session = await createSavedSession();
		session.replay("undo");
		await session.queue.flush();
		expect(structureClient.structures.delete).toHaveBeenCalledWith({
			id: original.id,
		});
		expect(reloadSession().getSnapshot().structures).toEqual([]);
		expect(storage[backupKey]).toBeUndefined();
		session.replay("redo");
		await session.queue.flush();
		expect(persisted.size).toBe(1);
		expect([...persisted.keys()]).toEqual([original.id]);
		expect(structureClient.structures.create).toHaveBeenCalledTimes(2);
	});
	it("retains a pending deletion across a crash and clears its backup only after success", async () => {
		const session = await createSavedSession();
		session.queue.setOnline(false);
		session.replay("undo");
		expect(JSON.parse(storage[backupKey] ?? "null").structure).toBeNull();
		const recovered = reloadSession();
		expect(recovered.getSnapshot().structures).toEqual([]);
		await recovered.queue.flush();
		expect(persisted.size).toBe(0);
		expect(Object.keys(storage)).toEqual([]);
		expect(reloadSession().getSnapshot().structures).toEqual([]);
	});
	it("keeps undo while a create is in flight and never duplicates a racing refetch", async () => {
		const completion = Promise.withResolvers<Structure>();
		vi.mocked(structureClient.structures.create).mockImplementationOnce(
			() => completion.promise,
		);
		const session = new StructureEditorSession({ userId });
		session.commit(original, "create");
		await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
		const saved = { ...original, createdAt: new Date(), updatedAt: new Date() };
		persisted.set(saved.id, saved);
		session.mergeRemote([saved], session.version);
		expect(session.getSnapshot().structures).toHaveLength(1);
		session.replay("undo");
		completion.resolve(saved);
		await vi.advanceTimersByTimeAsync(0);
		session.queue.setOnline(false);
		const recovered = reloadSession();
		expect(recovered.getSnapshot().structures).toEqual([]);
		await recovered.queue.flush();
		expect(persisted.size).toBe(0);
		expect(storage[backupKey]).toBeUndefined();
	});
	it("keeps a confirmed missing deletion hidden from a stale list", async () => {
		const session = await createSavedSession();
		const staleStructures = structuredClone([...persisted.values()]);
		persisted.clear();
		session.replay("undo");
		await session.queue.flush();
		session.mergeRemote(staleStructures, session.version);
		expect(session.getSnapshot().structures).toEqual([]);
		expect(storage[backupKey]).toBeUndefined();
		expect(session.getSnapshot().canRedo).toBe(true);
	});
	it("makes a lost create response idempotent when restored before the list returns", async () => {
		vi.mocked(structureClient.structures.create).mockImplementationOnce(
			async (fields) => {
				persisted.set(fields.id, {
					...fields,
					createdAt: new Date(),
					updatedAt: new Date(),
				});
				throw new TypeError("response lost");
			},
		);
		const session = new StructureEditorSession({ userId });
		session.commit(original, "create");
		expect(await session.queue.flush()).toBe(false);
		session.queue.setOnline(false);
		const recovered = new StructureEditorSession({ userId });
		recovered.restorePending();
		await recovered.queue.flush();
		expect(persisted.size).toBe(1);
		expect(structureClient.structures.create).toHaveBeenCalledTimes(2);
		expect(storage[backupKey]).toBeUndefined();
	});
	it("preserves newer edits when an idempotent restored create returns an older snapshot", async () => {
		persisted.set(original.id, {
			...original,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		storage[backupKey] = JSON.stringify({
			structure: { ...original, notes: "newer" },
			persisted: false,
		});
		const recovered = new StructureEditorSession({ userId });
		recovered.restorePending();
		await recovered.queue.flush();
		expect(persisted.get(original.id)?.notes).toBe("newer");
		expect(persisted.size).toBe(1);
	});
	it("never restores another user's backups or unscoped legacy backups", () => {
		const session = new StructureEditorSession({ userId });
		session.queue.setOnline(false);
		session.commit(original, "create");
		storage[`${ENGINEERING_PENDING_STORAGE_PREFIX}legacy`] = JSON.stringify({
			structure: original,
			persisted: false,
		});
		const otherUser = reloadSession("engineer-b");
		expect(otherUser.getSnapshot().structures).toEqual([]);
		expect(otherUser.queue.hasPending).toBe(false);
		expect(storage[backupKey]).toBeDefined();
		expect(reloadSession().getSnapshot().structures[0]?.id).toBe(original.id);
	});
	it("treats undo before the first POST as a deletion and preserves redo", async () => {
		const session = new StructureEditorSession({ userId });
		session.commit(original, "create");
		session.replay("undo");
		await session.queue.flush();
		expect(persisted.size).toBe(0);
		expect(storage[backupKey]).toBeUndefined();
		expect(session.getSnapshot().canRedo).toBe(true);
		session.replay("redo");
		await session.queue.flush();
		expect(persisted.size).toBe(1);
	});
});

describe("error handling and commit boundaries", () => {
	it("rejects invalid R3F edits without throwing or queuing them", () => {
		const onInvalidEdit = vi.fn();
		const session = new StructureEditorSession({ userId, onInvalidEdit });
		expect(() =>
			session.commit({ ...original, name: "" }, "invalid"),
		).not.toThrow();
		expect(onInvalidEdit).toHaveBeenCalledWith(original.id);
		expect(session.queue.hasPending).toBe(false);
		expect(session.history.canUndo).toBe(false);
	});
	it("drops NOT_FOUND updates and stops protecting the missing entity", async () => {
		const session = await createSavedSession();
		persisted.clear();
		session.commit({ ...original, notes: "edit" }, "notes");
		await session.queue.flush();
		expect(session.getSnapshot().structures).toEqual([]);
		expect(session.queue.hasPending).toBe(false);
		expect(storage[backupKey]).toBeUndefined();
		expect(session.history.canUndo).toBe(false);
		session.mergeRemote([], session.version);
		expect(session.getSnapshot().structures).toEqual([]);
	});
	it("keeps BAD_REQUEST rejected without retries and offers discard through the rejection callback", async () => {
		const onRejected = vi.fn();
		const session = new StructureEditorSession({ userId, onRejected });
		vi.mocked(structureClient.structures.create).mockRejectedValueOnce(
			new ORPCError("BAD_REQUEST"),
		);
		session.commit(original, "create");
		expect(await session.queue.flush()).toBe(false);
		expect(onRejected).toHaveBeenCalledWith(original.id);
		expect(session.getSnapshot().save.rejectedIds.has(original.id)).toBe(true);
		await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_BASE_MS);
		expect(structureClient.structures.create).toHaveBeenCalledTimes(1);
		session.queue.setOnline(false);
		const recovered = reloadSession();
		expect(await recovered.queue.flush()).toBe(false);
		expect(structureClient.structures.create).toHaveBeenCalledTimes(1);
		recovered.discard(original.id);
		expect(recovered.getSnapshot().structures).toEqual([]);
		expect(storage[backupKey]).toBeUndefined();
	});
	it("saves a newer edit when an older in-flight snapshot is rejected", async () => {
		const session = await createSavedSession();
		const completion = Promise.withResolvers<Structure>();
		vi.mocked(structureClient.structures.update).mockImplementationOnce(
			() => completion.promise,
		);
		session.commit({ ...original, notes: "rejected snapshot" }, "first");
		await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
		session.commit({ ...original, notes: "corrected snapshot" }, "next");
		completion.reject(new ORPCError("BAD_REQUEST"));
		await vi.advanceTimersByTimeAsync(0);
		expect(await session.queue.flush()).toBe(true);
		expect(persisted.get(original.id)?.notes).toBe("corrected snapshot");
		expect(session.getSnapshot().save.rejectedIds.size).toBe(0);
	});
	it.each([new TypeError("offline"), new ORPCError("INTERNAL_SERVER_ERROR")])(
		"retries transient failures with backoff",
		async (error) => {
			vi.mocked(structureClient.structures.create).mockRejectedValueOnce(error);
			const session = new StructureEditorSession({ userId });
			session.commit(original, "create");
			await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
			expect(session.getSnapshot().save.failed).toBe(true);
			await vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_BASE_MS);
			expect(session.queue.hasPending).toBe(false);
			expect(persisted.size).toBe(1);
		},
	);
	it("shares online state with the UI and saves only after reconnecting", async () => {
		const session = new StructureEditorSession({ userId });
		session.queue.setOnline(false);
		session.commit(original, "create");
		await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
		expect(structureClient.structures.create).not.toHaveBeenCalled();
		expect(session.getSnapshot().save.isOnline).toBe(false);
		expect(await session.queue.flush()).toBe(false);
		session.queue.setOnline(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(persisted.size).toBe(1);
		expect(session.getSnapshot().save.isOnline).toBe(true);
	});
	it("notifies the toast boundary on the next committed step, not on an unchanged edit", async () => {
		const onCommit = vi.fn();
		const session = new StructureEditorSession({ userId, onCommit });
		const step = session.commit(original, "create");
		await session.queue.flush();
		session.commit(original, "unchanged");
		expect(onCommit).toHaveBeenCalledTimes(1);
		session.commit({ ...original, notes: "next step" }, "notes");
		expect(onCommit).toHaveBeenCalledTimes(2);
		expect(step && session.history.isTop(step)).toBe(false);
	});
});

describe("polling consistency", () => {
	it("reuses identical timestamps and publishes nothing when a poll is unchanged", async () => {
		const session = await createSavedSession();
		const saved = structuredClone([...persisted.values()]);
		session.mergeRemote(saved, session.version);
		const before = session.getSnapshot();
		const listener = vi.fn();
		session.subscribe(listener);
		session.mergeRemote(structuredClone(saved), session.version);
		expect(session.getSnapshot()).toBe(before);
		expect(listener).not.toHaveBeenCalled();
	});
	it("protects a pending edit and a saved edit until the server timestamp catches up, even across newer requests", async () => {
		const session = await createSavedSession();
		const previous = structuredClone([...persisted.values()]);
		session.mergeRemote(previous, session.version);
		session.commit({ ...original, notes: "latest" }, "notes");
		session.mergeRemote(previous, session.version);
		expect(session.getSnapshot().structures[0]?.notes).toBe("latest");
		await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
		session.mergeRemote(previous, session.version);
		session.mergeRemote([], session.version);
		expect(session.getSnapshot().structures[0]?.notes).toBe("latest");
		session.mergeRemote(
			structuredClone([...persisted.values()]),
			session.version,
		);
		const current = session.getSnapshot().structures[0];
		session.mergeRemote(previous, session.version);
		expect(session.getSnapshot().structures[0]).toBe(current);
	});
	it("holds just-saved creations through an omitted list and still deletes them on undo", async () => {
		const session = await createSavedSession();
		session.mergeRemote([], session.version);
		expect(session.getSnapshot().structures).toHaveLength(1);
		session.replay("undo");
		await session.queue.flush();
		expect(persisted.size).toBe(0);
		expect(reloadSession().getSnapshot().structures).toEqual([]);
	});
	it("does not clobber changes made while a save is in flight", async () => {
		const session = await createSavedSession();
		const completion = Promise.withResolvers<Structure>();
		vi.mocked(structureClient.structures.update).mockImplementationOnce(
			() => completion.promise,
		);
		session.commit({ ...original, notes: "first" }, "first");
		await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
		session.commit({ ...original, notes: "newer" }, "newer");
		const firstSaved = {
			...original,
			notes: "first",
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		persisted.set(original.id, firstSaved);
		completion.resolve(firstSaved);
		await vi.advanceTimersByTimeAsync(0);
		expect(session.getSnapshot().structures[0]?.notes).toBe("newer");
		await session.queue.flush();
		expect(persisted.get(original.id)?.notes).toBe("newer");
		expect(storage[backupKey]).toBeUndefined();
	});
});
