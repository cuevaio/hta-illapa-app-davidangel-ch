import { isDemoAccountEmail } from "@hack-the-andes-project/business/demo-account";
import {
	AuthForm,
	type AuthMode,
} from "@hack-the-andes-project/ui/components/auth-form";
import { AuthShell } from "@hack-the-andes-project/ui/components/auth-shell";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { LanguageToggle } from "@/components/language-toggle";
import { ThemeSwitchControl } from "@/components/theme-switch-control";
import {
	AUTH_ERROR_MESSAGES,
	DEFAULT_AUTH_ERROR_MESSAGE,
	RATE_LIMITED_AUTH_MESSAGE,
	TOO_MANY_REQUESTS_STATUS,
} from "@/constants";
import { authClient } from "@/lib/auth-client";

interface LoginSearch {
	mode?: AuthMode;
}

export const Route = createFileRoute("/login")({
	head: () => ({ meta: [{ title: "Entrar · Illapa" }] }),
	validateSearch: (search: Record<string, unknown>): LoginSearch => ({
		mode:
			search.mode === "sign-up" || search.mode === "sign-in"
				? search.mode
				: undefined,
	}),
	beforeLoad: async () => {
		const session = await authClient.getSession().catch(() => null);
		if (session?.data && !isDemoAccountEmail(session.data.user.email)) {
			throw redirect({ to: "/dashboard" });
		}
	},
	component: LoginRoute,
});

function LoginRoute() {
	const navigate = useNavigate();
	const { queryClient } = Route.useRouteContext();
	const { mode: initialMode } = Route.useSearch();
	const [mode, setMode] = useState<AuthMode>(initialMode ?? "sign-in");

	return (
		<AuthShell
			headerActions={
				<>
					<LanguageToggle />
					<ThemeSwitchControl />
				</>
			}
		>
			<AuthForm
				key={mode}
				mode={mode}
				onModeChange={setMode}
				onSubmit={async ({ name, email, password }) => {
					const { error } = await (mode === "sign-up"
						? authClient.signUp.email({ name, email, password })
						: authClient.signIn.email({ email, password })
					).catch(() => ({ error: { status: 0, code: undefined } }));
					if (error) {
						if (error.status === TOO_MANY_REQUESTS_STATUS) {
							return RATE_LIMITED_AUTH_MESSAGE;
						}
						return (
							(error.code && AUTH_ERROR_MESSAGES[error.code]) ||
							DEFAULT_AUTH_ERROR_MESSAGE
						);
					}
					await queryClient.cancelQueries();
					queryClient.removeQueries();
					await navigate({ to: "/dashboard" });
					return undefined;
				}}
			/>
		</AuthShell>
	);
}
