import { type QueryClient, queryOptions } from "@tanstack/react-query";

import { structureFixtureClient } from "@/fixtures/structures/client";

export const structureClient = structureFixtureClient;

const STRUCTURE_QUERY_KEY = ["structures"] as const;

export const structureQueries = {
	list: queryOptions({
		queryKey: [...STRUCTURE_QUERY_KEY, "list"],
		queryFn: () => structureClient.structures.list(),
	}),
	detail: (id: string) =>
		queryOptions({
			queryKey: [...STRUCTURE_QUERY_KEY, "detail", id],
			queryFn: () => structureClient.structures.get({ id }),
		}),
};

export async function invalidateStructureQueries(queryClient: QueryClient) {
	await queryClient.invalidateQueries({ queryKey: STRUCTURE_QUERY_KEY });
}
