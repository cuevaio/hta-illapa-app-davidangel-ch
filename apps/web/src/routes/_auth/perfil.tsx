import type { UserRole } from "@hack-the-andes-project/api/structure-schemas";
import { isDemoAccountEmail } from "@hack-the-andes-project/business/demo-account";
import { TruckIcon } from "@hack-the-andes-project/ui/components/icons";
import { RolePicker } from "@hack-the-andes-project/ui/components/role-picker";
import { StructureArt } from "@hack-the-andes-project/ui/components/structure-art";
import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { useState } from "react";

import { LanguageToggle } from "@/components/language-toggle";
import { ThemeSwitchControl } from "@/components/theme-switch-control";
import { ROLE_HOME_PATHS } from "@/constants";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_auth/perfil")({
	head: () => ({ meta: [{ title: m.profile_page_title() }] }),
	beforeLoad: ({ context }) => {
		const user = context.session.data?.user;
		if (user?.role && isDemoAccountEmail(user.email)) {
			throw redirect({ to: ROLE_HOME_PATHS[user.role] });
		}
	},
	component: ProfilePage,
});

function ProfilePage() {
	const { session } = Route.useRouteContext();
	const router = useRouter();
	const navigate = useNavigate();
	const currentRole = session.data?.user.role ?? null;
	const [pendingRole, setPendingRole] = useState<UserRole | null>(null);
	const [hasError, setHasError] = useState(false);

	async function selectRole(role: UserRole) {
		if (role === currentRole) {
			await navigate({ to: ROLE_HOME_PATHS[role] });
			return;
		}
		setPendingRole(role);
		setHasError(false);
		const result = await authClient.updateUser({ role }).catch(() => null);
		if (!result || result.error) {
			setPendingRole(null);
			setHasError(true);
			return;
		}
		await router.invalidate();
		await navigate({ to: ROLE_HOME_PATHS[role] });
	}

	return (
		<RolePicker
			options={[
				{
					role: "fleet",
					title: m.profile_fleet_title(),
					description: m.profile_fleet_description(),
					art: (
						<TruckIcon aria-hidden="true" className="size-10 text-primary" />
					),
				},
				{
					role: "engineer",
					title: m.profile_engineer_title(),
					description: m.profile_engineer_description(),
					art: <StructureArt kind="bridge" className="size-16" />,
				},
			]}
			currentRole={currentRole}
			pendingRole={pendingRole}
			hasError={hasError}
			labels={{
				title: m.profile_title(),
				description: m.profile_description(),
				current: m.profile_current(),
				saving: m.profile_saving(),
				error: m.profile_error(),
			}}
			onSelect={selectRole}
			headerActions={
				<>
					<LanguageToggle />
					<ThemeSwitchControl />
				</>
			}
			footer={
				currentRole && (
					<Link
						to={ROLE_HOME_PATHS[currentRole]}
						className="self-start text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
					>
						{m.profile_back()}
					</Link>
				)
			}
		/>
	);
}
