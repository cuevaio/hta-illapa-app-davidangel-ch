"use client";

import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import {
	type ComponentType,
	type ReactElement,
	type ReactNode,
	useEffect,
	useId,
} from "react";

import { SIDEBAR_TOGGLE_SHORTCUT } from "../constants";
import { IllapaLockup, IllapaMark } from "./illapa-logo";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	SidebarSeparator,
	useSidebar,
} from "./sidebar";

export interface DashboardNavigationItem {
	id: string;
	label: string;
	icon: ComponentType;
	link: ReactElement;
	active: boolean;
	badgeCount?: number;
}

export interface DashboardSidebarProps {
	items: DashboardNavigationItem[];
	homeLink: ReactElement;
	account: (collapsed: boolean) => ReactNode;
	expandLabel: string;
	collapseLabel: string;
}

export function DashboardSidebar({
	items,
	homeLink,
	account,
	expandLabel,
	collapseLabel,
}: DashboardSidebarProps) {
	const { state, isMobile, setOpenMobile, toggleSidebar } = useSidebar();
	const collapsed = state === "collapsed" && !isMobile;
	const toggleLabel = collapsed ? expandLabel : collapseLabel;
	const badgeIdPrefix = useId();

	useEffect(() => {
		if (isMobile) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.key !== SIDEBAR_TOGGLE_SHORTCUT ||
				event.defaultPrevented ||
				event.repeat ||
				event.isComposing ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				(event.target instanceof Element &&
					event.target.closest(
						"input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
					))
			)
				return;
			event.preventDefault();
			toggleSidebar();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isMobile, toggleSidebar]);

	return (
		<Sidebar collapsible="icon">
			<SidebarHeader className="flex-row items-center gap-1 p-2 group-data-[collapsible=icon]:flex-col">
				<SidebarMenu className="min-w-0 flex-1 group-data-[collapsible=icon]:flex-none">
					<SidebarMenuItem>
						<SidebarMenuButton
							size="lg"
							render={homeLink}
							tooltip="illapa"
							aria-label="illapa"
							className="h-16 group-data-[collapsible=icon]:justify-center"
							onClick={() => setOpenMobile(false)}
						>
							{collapsed ? (
								<IllapaMark className="size-8!" />
							) : (
								<span className="flex min-w-0 flex-col gap-0.5">
									<IllapaLockup markClassName="size-6!" />
									<span className="type-label pl-8 text-muted-foreground">
										Inteligencia en ruta
									</span>
								</span>
							)}
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
				<SidebarMenu className="w-auto">
					<SidebarMenuItem>
						<SidebarMenuButton
							aria-label={toggleLabel}
							aria-expanded={!collapsed}
							aria-keyshortcuts={SIDEBAR_TOGGLE_SHORTCUT}
							tooltip={toggleLabel}
							onClick={toggleSidebar}
							className="size-8 shrink-0 justify-center"
						>
							{collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarSeparator />
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel className="type-label!">
						Centro de operaciones · Perú
					</SidebarGroupLabel>
					<SidebarGroupContent>
						<nav aria-label="Navegación principal">
							<SidebarMenu>
								{items.map((item) => (
									<SidebarMenuItem key={item.id}>
										<SidebarMenuButton
											render={item.link}
											isActive={item.active}
											tooltip={item.label}
											aria-label={item.label}
											aria-describedby={
												item.badgeCount
													? `${badgeIdPrefix}-${item.id}`
													: undefined
											}
											aria-current={item.active ? "page" : undefined}
											onClick={() => setOpenMobile(false)}
										>
											<item.icon />
											<span className="font-medium font-sans text-sm transition-opacity duration-200 group-data-[collapsible=icon]:opacity-0 motion-reduce:transition-none">
												{item.label}
											</span>
										</SidebarMenuButton>
										{Boolean(item.badgeCount) && (
											<>
												<SidebarMenuBadge className="type-data!">
													{item.badgeCount}
												</SidebarMenuBadge>
												<span
													id={`${badgeIdPrefix}-${item.id}`}
													className="sr-only"
												>
													{item.badgeCount} alertas abiertas
												</span>
												<span
													aria-hidden="true"
													className="pointer-events-none absolute top-1 right-1 hidden size-1.5 rounded-full bg-sidebar-foreground ring-2 ring-sidebar group-data-[collapsible=icon]:block"
												/>
											</>
										)}
									</SidebarMenuItem>
								))}
							</SidebarMenu>
						</nav>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarSeparator />
			<SidebarFooter className="gap-3 p-2">
				<p className="type-label text-muted-foreground group-data-[collapsible=icon]:hidden">
					Clima, vías y flota en un solo lugar.
				</p>
				{account(collapsed)}
			</SidebarFooter>
			{!isMobile && (
				<SidebarRail aria-label={toggleLabel} title={toggleLabel} />
			)}
		</Sidebar>
	);
}
