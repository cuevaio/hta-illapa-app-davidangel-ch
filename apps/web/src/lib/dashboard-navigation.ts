import {
	BellIcon,
	MapIcon,
	NewspaperIcon,
	RouteIcon,
	SettingsIcon,
	TruckIcon,
} from "@hack-the-andes-project/ui/components/icons";
import type { LinkProps } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { m } from "@/paraglide/messages";

interface DashboardNavigationEntry {
	to: NonNullable<LinkProps["to"]>;
	label: string;
	icon: ComponentType;
	exact?: boolean;
}

export const DASHBOARD_NAVIGATION: DashboardNavigationEntry[] = [
	{ to: "/dashboard", label: m.nav_map(), icon: MapIcon, exact: true },
	{
		to: "/dashboard/revisar-ruta",
		label: m.route_review_title(),
		icon: RouteIcon,
	},
	{ to: "/dashboard/fleet", label: m.nav_fleet(), icon: TruckIcon },
	{ to: "/dashboard/alerts", label: m.nav_alerts(), icon: BellIcon },
	{ to: "/dashboard/news", label: m.nav_news(), icon: NewspaperIcon },
	{ to: "/dashboard/settings", label: m.nav_settings(), icon: SettingsIcon },
];
