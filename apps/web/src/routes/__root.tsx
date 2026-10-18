import { Toaster } from "@hack-the-andes-project/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { ThemeProvider } from "@/components/theme-provider";
import { m } from "@/paraglide/messages";
import type { orpc } from "@/utils/orpc";

import "../index.css";

export interface RouterAppContext {
	orpc: typeof orpc;
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	component: RootComponent,
	head: () => ({
		meta: [
			{
				title: m.app_title(),
			},
			{
				name: "description",
				content: m.app_description(),
			},
		],
		links: [
			{
				rel: "icon",
				href: "/favicon.svg",
				type: "image/svg+xml",
			},
			{
				rel: "icon",
				href: "/favicon-32.png",
				sizes: "32x32",
				type: "image/png",
			},
			{
				rel: "apple-touch-icon",
				href: "/apple-touch-icon.png",
			},
		],
	}),
});

function RootComponent() {
	return (
		<>
			<HeadContent />
			<ThemeProvider
				attribute="class"
				defaultTheme="light"
				enableSystem
				disableTransitionOnChange
				storageKey="illapa-theme"
			>
				<div className="min-h-svh">
					<Outlet />
				</div>
				<Toaster />
			</ThemeProvider>
			{import.meta.env.DEV && (
				<>
					<TanStackRouterDevtools position="bottom-left" />
					<ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
				</>
			)}
		</>
	);
}
