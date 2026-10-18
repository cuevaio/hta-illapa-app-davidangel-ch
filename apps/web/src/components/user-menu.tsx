import { AccountMenu } from "@hack-the-andes-project/ui/components/account-menu";
import {
	Avatar,
	AvatarFallback,
} from "@hack-the-andes-project/ui/components/avatar";
import { SidebarMenuButton } from "@hack-the-andes-project/ui/components/sidebar";
import { Skeleton } from "@hack-the-andes-project/ui/components/skeleton";
import { useFontSize } from "@hack-the-andes-project/ui/hooks/use-font-size";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { useState } from "react";
import { USER_INITIALS_CHARACTER_COUNT } from "@/constants";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";
import { getLocale, locales, setLocale } from "@/paraglide/runtime";

interface UserMenuProps {
	collapsed?: boolean;
}

export default function UserMenu({ collapsed = false }: UserMenuProps) {
	const navigate = useNavigate();
	const { data: session, isPending } = authClient.useSession();
	const { theme, setTheme } = useTheme();
	const { fontSize, setFontSize } = useFontSize();
	const [isSigningOut, setIsSigningOut] = useState(false);
	const [hasSignOutError, setHasSignOutError] = useState(false);
	const currentLocale = getLocale();

	if (isPending) {
		return (
			<Skeleton className={collapsed ? "size-8 rounded-full" : "h-14 w-full"} />
		);
	}

	if (!session) {
		return (
			<SidebarMenuButton
				render={<Link to="/login" />}
				tooltip={m.account_sign_in()}
				aria-label={m.account_sign_in()}
			>
				<Avatar size="sm">
					<AvatarFallback>?</AvatarFallback>
				</Avatar>
				{!collapsed && <span>{m.account_sign_in()}</span>}
			</SidebarMenuButton>
		);
	}

	const initials = session.user.name
		.split(" ")
		.map((part) => part.charAt(0))
		.join("")
		.slice(0, USER_INITIALS_CHARACTER_COUNT)
		.toUpperCase();

	return (
		<AccountMenu
			collapsed={collapsed}
			name={session.user.name}
			email={session.user.email}
			initials={initials}
			theme={theme === "dark" || theme === "system" ? theme : "light"}
			onThemeChange={setTheme}
			language={currentLocale}
			languages={locales.map((locale) => ({
				value: locale,
				label: locale.toUpperCase(),
				accessibleLabel:
					new Intl.DisplayNames([locale], { type: "language" }).of(locale) ??
					locale,
			}))}
			onLanguageChange={(locale) => {
				if (locale !== currentLocale) setLocale(locale);
			}}
			fontSize={fontSize}
			setFontSize={setFontSize}
			labels={{
				trigger: m.account_menu({ name: session.user.name }),
				preferences: m.account_preferences(),
				theme: m.account_theme(),
				themes: {
					light: m.account_theme_light(),
					dark: m.account_theme_dark(),
					system: m.account_theme_system(),
				},
				language: m.account_language(),
				fontSize: m.account_font_size(),
				fontSizes: {
					sm: m.account_font_size_small(),
					md: m.account_font_size_medium(),
					lg: m.account_font_size_large(),
				},
				signOut: m.account_sign_out(),
				signingOut: m.account_signing_out(),
				signOutError: m.account_sign_out_error(),
			}}
			isSigningOut={isSigningOut}
			hasSignOutError={hasSignOutError}
			onSignOut={async () => {
				setIsSigningOut(true);
				setHasSignOutError(false);
				try {
					const { error } = await authClient.signOut();
					if (error) {
						setHasSignOutError(true);
						return;
					}
					await navigate({ to: "/login" });
				} catch {
					setHasSignOutError(true);
				} finally {
					setIsSigningOut(false);
				}
			}}
		/>
	);
}
