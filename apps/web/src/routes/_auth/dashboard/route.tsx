import { isDemoAccountEmail } from "@hack-the-andes-project/business/demo-account";
import { DashboardSidebar } from "@hack-the-andes-project/ui/components/dashboard-sidebar";
import { DemoBanner } from "@hack-the-andes-project/ui/components/demo-banner";
import { Separator } from "@hack-the-andes-project/ui/components/separator";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@hack-the-andes-project/ui/components/sidebar";
import { useSidebarPreference } from "@hack-the-andes-project/ui/hooks/use-sidebar-preference";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import UserMenu from "@/components/user-menu";
import {
	ALERT_REFETCH_INTERVAL_MS,
	SEEN_ALERTS_STORAGE_PREFIX,
} from "@/constants";
import { authClient } from "@/lib/auth-client";
import { DASHBOARD_NAVIGATION } from "@/lib/dashboard-navigation";
import { useFleetQueries } from "@/lib/fleet-queries";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_auth/dashboard")({
	component: DashboardLayout,
});

function DashboardLayout() {
	const { open, setOpen } = useSidebarPreference("illapa-sidebar");
	const fleetQueries = useFleetQueries();
	const navigate = useNavigate();
	const { session, queryClient } = Route.useRouteContext();
	const leaveDemo = useMutation({
		retry: false,
		mutationFn: async () => {
			const { error } = await authClient.signOut();
			if (error) throw error;
			await queryClient.cancelQueries();
			queryClient.removeQueries();
			await navigate({ to: "/login", search: { mode: "sign-up" } });
		},
	});
	const alertsQuery = useQuery({
		...fleetQueries.openAlerts,
		refetchInterval: ALERT_REFETCH_INTERVAL_MS,
	});
	const seenAlerts = useRef({
		scope: "",
		ids: new Set<string>(),
		storageAvailable: true,
	});
	const sessionScope = `${session.data?.session.id}:${session.data?.session.activeOrganizationId}`;

	useEffect(() => {
		if (!alertsQuery.data) return;
		const storageKey = `${SEEN_ALERTS_STORAGE_PREFIX}:${sessionScope}`;
		if (seenAlerts.current.scope !== sessionScope) {
			seenAlerts.current = {
				scope: sessionScope,
				ids: new Set<string>(),
				storageAvailable: true,
			};
			try {
				const storedIds: unknown = JSON.parse(
					sessionStorage.getItem(storageKey) ?? "[]",
				);
				if (Array.isArray(storedIds)) {
					seenAlerts.current.ids = new Set(
						storedIds.filter((id): id is string => typeof id === "string"),
					);
				}
			} catch {
				seenAlerts.current.storageAvailable = false;
			}
		}
		for (const alert of alertsQuery.data) {
			if (seenAlerts.current.ids.has(alert.id)) continue;
			seenAlerts.current.ids.add(alert.id);
			toast.warning(alert.title, {
				id: `${sessionScope}:${alert.id}`,
				description: `${alert.vehicleName ?? "Vehículo"} · ${alert.message}`,
				action: {
					label: "Ver alertas",
					onClick: () => navigate({ to: "/dashboard/alerts" }),
				},
			});
		}
		if (seenAlerts.current.storageAvailable) {
			try {
				sessionStorage.setItem(
					storageKey,
					JSON.stringify([...seenAlerts.current.ids]),
				);
			} catch {
				seenAlerts.current.storageAvailable = false;
			}
		}
	}, [alertsQuery.data, sessionScope, navigate]);
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const navigationItems = DASHBOARD_NAVIGATION.map((item) => ({
		id: item.to,
		label: item.label,
		badgeCount:
			item.to === "/dashboard/alerts" ? alertsQuery.data?.length : undefined,
		icon: item.icon,
		link: <Link to={item.to} />,
		active: item.exact
			? pathname === item.to || pathname === `${item.to}/`
			: pathname === item.to || pathname.startsWith(`${item.to}/`),
	}));

	return (
		<SidebarProvider
			open={open}
			onOpenChange={setOpen}
			className="h-svh overflow-hidden"
		>
			<DashboardSidebar
				items={navigationItems}
				account={(collapsed) => <UserMenu collapsed={collapsed} />}
				expandLabel={m.sidebar_expand()}
				collapseLabel={m.sidebar_collapse()}
			/>
			<SidebarInset className="min-w-0 overflow-hidden">
				{isDemoAccountEmail(session.data?.user.email) ? (
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
				) : null}
				<header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
					<SidebarTrigger
						className="md:hidden"
						aria-label={m.sidebar_toggle()}
					/>
					<Separator orientation="vertical" className="h-4 md:hidden" />
					<h1 className="type-heading min-w-0 truncate">
						{navigationItems.find((item) => item.active)?.label ??
							"Centro de operaciones"}
					</h1>
				</header>
				<div className="flex min-h-0 flex-1 flex-col overflow-auto">
					<Outlet />
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
