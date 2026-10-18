import type {
	Structure,
	StructureInput,
} from "@hack-the-andes-project/api/structure-schemas";

import { ISO_DATE_PATTERN } from "@/fixtures/route-review/constants";

import {
	STRUCTURE_FIXTURE_LATENCY_MS,
	STRUCTURE_FIXTURE_STORAGE_KEY,
	STRUCTURE_NOT_FOUND_MESSAGE,
} from "./constants";
import { SEEDED_STRUCTURES } from "./seed";

function readStoredStructures(): Structure[] | null {
	try {
		const storedStructures = localStorage.getItem(
			STRUCTURE_FIXTURE_STORAGE_KEY,
		);
		return storedStructures
			? JSON.parse(storedStructures, (_key, value) =>
					typeof value === "string" && ISO_DATE_PATTERN.test(value)
						? new Date(value)
						: value,
				)
			: null;
	} catch {
		return null;
	}
}

const structures: Structure[] =
	readStoredStructures() ?? structuredClone(SEEDED_STRUCTURES);

function findStructureIndex(id: string) {
	const index = structures.findIndex((structure) => structure.id === id);
	if (index === -1) throw new Error(STRUCTURE_NOT_FOUND_MESSAGE);
	return index;
}

async function respond<Result>(produce: () => Result): Promise<Result> {
	await new Promise((resolve) =>
		setTimeout(resolve, STRUCTURE_FIXTURE_LATENCY_MS),
	);
	const result = produce();
	try {
		localStorage.setItem(
			STRUCTURE_FIXTURE_STORAGE_KEY,
			JSON.stringify(structures),
		);
	} catch {}
	return structuredClone(result);
}

export const structureFixtureClient = {
	structures: {
		list: () => respond(() => structures),
		get: ({ id }: { id: string }) =>
			respond(() => structures[findStructureIndex(id)]),
		create: (input: StructureInput) =>
			respond(() => {
				const existing = structures.find(
					(structure) => structure.id === input.id,
				);
				if (existing) return existing;
				const now = new Date();
				const structure: Structure = {
					...input,
					createdAt: now,
					updatedAt: now,
				};
				structures.push(structure);
				return structure;
			}),
		update: ({ id, ...fields }: StructureInput) =>
			respond(() => {
				const index = findStructureIndex(id);
				const structure: Structure = {
					...structures[index],
					...fields,
					id,
					updatedAt: new Date(),
				};
				structures[index] = structure;
				return structure;
			}),
		delete: ({ id }: { id: string }) =>
			respond(() => {
				structures.splice(findStructureIndex(id), 1);
				return { id };
			}),
	},
};
