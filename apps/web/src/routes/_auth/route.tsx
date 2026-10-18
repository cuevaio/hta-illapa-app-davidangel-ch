import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { PROFILE_PATH } from "@/constants";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_auth")({
	component: AuthLayout,
	beforeLoad: async ({ location }) => {
		const session = await authClient.getSession();
		if (!session.data) {
			throw redirect({
				to: "/login",
			});
		}
		if (!session.data.user.role && location.pathname !== PROFILE_PATH) {
			throw redirect({ to: PROFILE_PATH });
		}
		return { session };
	},
});

function AuthLayout() {
	return <Outlet />;
}
