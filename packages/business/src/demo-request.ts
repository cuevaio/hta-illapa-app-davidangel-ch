import { z } from "zod";

import {
	DEMO_COMPANY_MAX_LENGTH_CHARS,
	DEMO_EMAIL_MAX_LENGTH_CHARS,
	DEMO_NAME_MAX_LENGTH_CHARS,
	DEMO_PHONE_MAX_LENGTH_CHARS,
} from "./constants";

export const DEMO_REQUESTS_PATH = "/api/demo-requests";

export interface DemoRequest {
	name: string;
	company?: string;
	phone?: string;
	email?: string;
}

export const demoRequestSchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(1, "Escribe tu nombre.")
			.max(DEMO_NAME_MAX_LENGTH_CHARS),
		company: z.string().trim().max(DEMO_COMPANY_MAX_LENGTH_CHARS).optional(),
		phone: z.string().trim().max(DEMO_PHONE_MAX_LENGTH_CHARS).optional(),
		email: z
			.string()
			.trim()
			.max(DEMO_EMAIL_MAX_LENGTH_CHARS)
			.pipe(z.email("Escribe un correo válido.").or(z.literal("")))
			.optional(),
	})
	.refine((request) => Boolean(request.phone || request.email), {
		message: "Escribe al menos un teléfono o correo para contactarte.",
		path: ["phone"],
	});
