import PE from "country-flag-icons/react/3x2/PE";
import US from "country-flag-icons/react/3x2/US";
import {
	ArrowLeftRight,
	ChevronsUpDown,
	LogOut,
	Monitor,
	Moon,
	Sun,
} from "lucide-react";

import { FONT_SIZE_OPTIONS } from "../constants";
import type { FontSizePreference } from "../hooks/use-font-size";
import { Avatar, AvatarFallback } from "./avatar";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Separator } from "./separator";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./sidebar";
import { Spinner } from "./spinner";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

const LANGUAGE_FLAGS = { es: PE, en: US };
const THEME_OPTIONS: readonly ["light", "dark", "system"] = [
	"light",
	"dark",
	"system",
];
const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor };
const FONT_SIZE_LABELS = { sm: "S", md: "M", lg: "L" };
// The toggle's pressed fill is bg-muted, which equals the dark popover
// background, so the chosen segment gets its own tint and inset outline.
const SEGMENT_ITEM_CLASS =
	"flex-1 aria-pressed:bg-primary/10 aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-primary aria-pressed:ring-inset";

export interface AccountMenuLanguage {
	value: keyof typeof LANGUAGE_FLAGS;
	label: string;
	accessibleLabel: string;
}

interface AccountMenuLabels {
	trigger: string;
	preferences: string;
	theme: string;
	themes: Record<keyof typeof THEME_ICONS, string>;
	language: string;
	fontSize: string;
	fontSizes: Record<FontSizePreference["fontSize"], string>;
	changeProfile: string;
	signOut: string;
	signingOut: string;
	signOutError: string;
}

interface AccountMenuProps extends FontSizePreference {
	name: string;
	email: string;
	initials: string;
	collapsed?: boolean;
	labels: AccountMenuLabels;
	theme: keyof typeof THEME_ICONS;
	onThemeChange: (theme: AccountMenuProps["theme"]) => void;
	language: AccountMenuLanguage["value"];
	languages: AccountMenuLanguage[];
	onLanguageChange: (language: AccountMenuLanguage["value"]) => void;
	onChangeProfile?: () => void;
	onSignOut: () => void;
	isSigningOut: boolean;
	hasSignOutError: boolean;
}

export function AccountMenu({
	name,
	email,
	initials,
	collapsed = false,
	labels,
	theme,
	onThemeChange,
	language,
	languages,
	onLanguageChange,
	fontSize,
	setFontSize,
	onChangeProfile,
	onSignOut,
	isSigningOut,
	hasSignOutError,
}: AccountMenuProps) {
	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<Popover>
					<PopoverTrigger
						render={
							<SidebarMenuButton
								size="lg"
								tooltip={name}
								aria-label={labels.trigger}
								className={collapsed ? "justify-center p-0!" : undefined}
							/>
						}
					>
						<Avatar>
							<AvatarFallback>{initials}</AvatarFallback>
						</Avatar>
						{!collapsed && (
							<>
								<span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
									<span className="truncate font-medium text-sm">{name}</span>
									<span className="truncate text-muted-foreground text-xs">
										{email}
									</span>
								</span>
								<ChevronsUpDown aria-hidden="true" />
							</>
						)}
					</PopoverTrigger>
					<PopoverContent
						side={collapsed ? "right" : "top"}
						align={collapsed ? "end" : "start"}
						aria-label={labels.trigger}
						className="w-72 gap-0 p-0"
					>
						<div className="flex items-center gap-2 p-3">
							<Avatar>
								<AvatarFallback>{initials}</AvatarFallback>
							</Avatar>
							<div className="flex min-w-0 flex-col gap-0.5">
								<span className="truncate font-medium text-sm">{name}</span>
								<span className="truncate text-muted-foreground text-xs">
									{email}
								</span>
							</div>
						</div>
						<Separator />
						<div className="flex flex-col gap-3 p-3">
							<p className="type-label text-muted-foreground">
								{labels.preferences}
							</p>
							<div className="flex flex-col gap-1.5">
								<span className="font-medium text-xs">{labels.theme}</span>
								<ToggleGroup
									variant="outline"
									size="sm"
									spacing={0}
									className="w-full"
									aria-label={labels.theme}
									value={[theme]}
									onValueChange={(selectedThemes) => {
										const selectedTheme = THEME_OPTIONS.find((option) =>
											selectedThemes.includes(option),
										);
										if (selectedTheme) onThemeChange(selectedTheme);
									}}
								>
									{THEME_OPTIONS.map((themeValue) => {
										const ThemeIcon = THEME_ICONS[themeValue];
										return (
											<ToggleGroupItem
												key={themeValue}
												value={themeValue}
												className={SEGMENT_ITEM_CLASS}
											>
												<ThemeIcon
													aria-hidden="true"
													data-icon="inline-start"
												/>
												{labels.themes[themeValue]}
											</ToggleGroupItem>
										);
									})}
								</ToggleGroup>
							</div>
							<div className="flex flex-col gap-1.5">
								<span className="font-medium text-xs">{labels.language}</span>
								<ToggleGroup
									variant="outline"
									size="sm"
									spacing={0}
									className="w-full"
									aria-label={labels.language}
									value={[language]}
									onValueChange={(selectedLanguages) => {
										const selectedLanguage = languages.find((option) =>
											selectedLanguages.includes(option.value),
										);
										if (selectedLanguage)
											onLanguageChange(selectedLanguage.value);
									}}
								>
									{languages.map((option) => {
										const Flag = LANGUAGE_FLAGS[option.value];
										return (
											<ToggleGroupItem
												key={option.value}
												value={option.value}
												lang={option.value}
												aria-label={option.accessibleLabel}
												className={SEGMENT_ITEM_CLASS}
											>
												<span
													aria-hidden="true"
													className="inline-flex h-3 w-4 overflow-hidden rounded-sm ring-1 ring-border"
												>
													<Flag className="size-full" />
												</span>
												{option.label}
											</ToggleGroupItem>
										);
									})}
								</ToggleGroup>
							</div>
							<div className="flex flex-col gap-1.5">
								<span className="font-medium text-xs">{labels.fontSize}</span>
								<ToggleGroup
									variant="outline"
									size="sm"
									spacing={0}
									className="w-full"
									aria-label={labels.fontSize}
									value={[fontSize]}
									onValueChange={(selectedFontSizes) => {
										const selectedFontSize = FONT_SIZE_OPTIONS.find((option) =>
											selectedFontSizes.includes(option),
										);
										if (selectedFontSize) setFontSize(selectedFontSize);
									}}
								>
									{FONT_SIZE_OPTIONS.map((option) => (
										<ToggleGroupItem
											key={option}
											value={option}
											aria-label={labels.fontSizes[option]}
											className={SEGMENT_ITEM_CLASS}
										>
											{FONT_SIZE_LABELS[option]}
										</ToggleGroupItem>
									))}
								</ToggleGroup>
							</div>
						</div>
						<Separator />
						<div className="flex flex-col gap-2 p-1">
							{onChangeProfile && (
								<Button
									variant="ghost"
									className="w-full justify-start"
									onClick={onChangeProfile}
								>
									<ArrowLeftRight aria-hidden="true" data-icon="inline-start" />
									{labels.changeProfile}
								</Button>
							)}
							<Button
								variant="ghost"
								className="w-full justify-start text-destructive hover:text-destructive"
								disabled={isSigningOut}
								aria-busy={isSigningOut}
								onClick={onSignOut}
							>
								{isSigningOut ? (
									<Spinner aria-hidden="true" data-icon="inline-start" />
								) : (
									<LogOut aria-hidden="true" data-icon="inline-start" />
								)}
								{isSigningOut ? labels.signingOut : labels.signOut}
							</Button>
							{hasSignOutError && (
								<p role="alert" className="px-2 pb-2 text-destructive text-xs">
									{labels.signOutError}
								</p>
							)}
						</div>
					</PopoverContent>
				</Popover>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
