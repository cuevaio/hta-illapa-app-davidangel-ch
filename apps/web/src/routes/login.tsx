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
	getAuthShellLabels,
	TOO_MANY_REQUESTS_STATUS,
} from "@/constants";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

interface LoginSearch {
	mode?: AuthMode;
}

export const Route = createFileRoute("/login")({
	head: () => ({ meta: [{ title: m.auth_page_title() }] }),
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
			labels={getAuthShellLabels()}
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
				labels={{
					signIn: {
						title: m.auth_sign_in_title(),
						description: m.auth_sign_in_description(),
						submit: m.auth_sign_in_submit(),
						pending: m.auth_sign_in_pending(),
						switchPrompt: m.auth_sign_in_switch_prompt(),
						switchAction: m.auth_sign_in_switch_action(),
					},
					signUp: {
						title: m.auth_sign_up_title(),
						description: m.auth_sign_up_description(),
						submit: m.auth_sign_up_submit(),
						pending: m.auth_sign_up_pending(),
						switchPrompt: m.auth_sign_up_switch_prompt(),
						switchAction: m.auth_sign_up_switch_action(),
					},
					name: m.auth_name_label(),
					namePlaceholder: m.auth_name_placeholder(),
					email: m.auth_email_label(),
					emailPlaceholder: m.auth_email_placeholder(),
					password: m.auth_password_label(),
					passwordHint: (minimumLength) =>
						m.auth_password_hint({ minimumLength }),
					invalidEmail: m.auth_invalid_email(),
					passwordRequired: m.auth_password_required(),
					nameTooShort: (minimumLength) =>
						m.auth_name_too_short({ minimumLength }),
					passwordTooShort: (minimumLength) =>
						m.auth_password_too_short({ minimumLength }),
				}}
				onModeChange={setMode}
				onSubmit={async ({ name, email, password }) => {
					const { error } = await (mode === "sign-up"
						? authClient.signUp.email({ name, email, password })
						: authClient.signIn.email({ email, password })
					).catch(() => ({ error: { status: 0, code: undefined } }));
					if (error) {
						if (error.status === TOO_MANY_REQUESTS_STATUS) {
							return m.auth_rate_limited();
						}
						const errorMessage = error.code
							? AUTH_ERROR_MESSAGES[error.code]
							: undefined;
						return errorMessage?.() ?? m.auth_request_failed();
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
