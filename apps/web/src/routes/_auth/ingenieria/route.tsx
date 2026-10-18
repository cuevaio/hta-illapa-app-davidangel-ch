import { isDemoAccountEmail } from "@hack-the-andes-project/business/demo-account";
import { canUseSimulators } from "@hack-the-andes-project/business/simulators";
import { DashboardSidebar } from "@hack-the-andes-project/ui/components/dashboard-sidebar";
import { DemoBanner } from "@hack-the-andes-project/ui/components/demo-banner";
import {
	SidebarInset,
	SidebarProvider,
} from "@hack-the-andes-project/ui/components/sidebar";
import { StructureEditorNavigationIcon } from "@hack-the-andes-project/ui/components/structure-editor-chrome";
import { useSidebarPreference } from "@hack-the-andes-project/ui/hooks/use-sidebar-preference";
import {
	createFileRoute,
	Link,
	redirect,
	useMatch,
} from "@tanstack/react-router";

import { StructureEditor } from "@/components/structure-editor";
import {
	StructureEditorProvider,
	useStructureEditor,
} from "@/components/structure-editor-provider";
import UserMenu from "@/components/user-menu";
import { useLeaveDemo } from "@/hooks/use-leave-demo";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_auth/ingenieria")({
	beforeLoad: ({ context }) => {
		if (!canUseSimulators(context.session.data?.user.role))
			throw redirect({ to: "/dashboard" });
	},
	component: () => {
		const { session } = Route.useRouteContext();
		return session.data ? (
			<StructureEditorProvider
				key={session.data.user.id}
				userId={session.data.user.id}
			>
				<EngineeringLayout />
			</StructureEditorProvider>
		) : null;
	},
});

function EngineeringLayout() {
	const { session } = Route.useRouteContext();
	const selectedId =
		useMatch({
			from: "/_auth/ingenieria/estructuras/$structureId",
			shouldThrow: false,
			select: (match) => match.params.structureId,
		}) ?? null;
	const { session: editorSession } = useStructureEditor();
	const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebarPreference(
		"illapa-sidebar-ingenieria",
		false,
	);
	const leaveDemo = useLeaveDemo(() => editorSession.queue.flush());
	return (
		<SidebarProvider
			open={sidebarOpen}
			onOpenChange={setSidebarOpen}
			className="h-svh overflow-hidden"
		>
			<DashboardSidebar
				items={[
					{
						id: "simulators",
						label: m.engineering_title(),
						icon: StructureEditorNavigationIcon,
						link: <Link to="/ingenieria" />,
						active: true,
					},
				]}
				account={(collapsed) => <UserMenu collapsed={collapsed} />}
				expandLabel={m.sidebar_expand()}
				collapseLabel={m.sidebar_collapse()}
				navigationLabel={m.engineering_navigation()}
			/>
			<SidebarInset className="min-w-0 overflow-hidden">
				{isDemoAccountEmail(session.data?.user.email) && (
					<DemoBanner
						message={m.demo_banner_message()}
						actionLabel={m.demo_create_account()}
						pendingLabel={m.demo_leaving()}
						isPending={leaveDemo.isPending}
						errorMessage={
							leaveDemo.isError ? m.demo_sign_out_error() : undefined
						}
						onCreateAccount={() => leaveDemo.mutate()}
					/>
				)}
				<StructureEditor selectedId={selectedId} />
			</SidebarInset>
		</SidebarProvider>
	);
}
