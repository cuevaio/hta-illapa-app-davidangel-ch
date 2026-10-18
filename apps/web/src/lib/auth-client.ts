import { userRoleSchema } from "@hack-the-andes-project/api/structure-schemas";
import {
	inferAdditionalFields,
	organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ENV } from "../env.public";

export const authClient = createAuthClient({
	baseURL: ENV.VITE_SERVER_URL,
	plugins: [
		organizationClient(),
		inferAdditionalFields({
			user: { role: { type: [...userRoleSchema.options], input: false } },
		}),
	],
	fetchOptions: {
		credentials: "include",
	},
});
