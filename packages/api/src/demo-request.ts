import { demoRequestSchema } from "@hack-the-andes-project/business/demo-request";
import type { Database } from "@hack-the-andes-project/db";
import { demoRequest } from "@hack-the-andes-project/db/schema/demo-request";

import { HTTP_STATUS_BAD_REQUEST, HTTP_STATUS_CREATED } from "./constants";
import type { Context } from "./context";

export interface DemoRequestInput {
	request: Request;
	createDatabase: () => Promise<Pick<Database, "insert">>;
	log: Pick<Context["log"], "set">;
}

export async function handleDemoRequest(input: DemoRequestInput) {
	const payload: unknown = await input.request.json().catch(() => null);
	const result = demoRequestSchema.safeParse(payload);
	if (!result.success) {
		return Response.json(
			{ error: "invalid_demo_request" },
			{ status: HTTP_STATUS_BAD_REQUEST },
		);
	}
	const requestId = crypto.randomUUID();
	const database = await input.createDatabase();
	await database.insert(demoRequest).values({
		id: requestId,
		name: result.data.name,
		company: result.data.company ?? null,
		phone: result.data.phone ?? null,
		email: result.data.email ?? null,
	});
	input.log.set({ demoRequest: { requestId } });
	return new Response(null, { status: HTTP_STATUS_CREATED });
}
