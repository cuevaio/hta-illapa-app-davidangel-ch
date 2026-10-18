import { cn } from "cn";
import type { ReactNode } from "react";

import { IllapaLockup } from "./illapa-logo";
import { StarRiver } from "./mayu-art";
import { Spinner } from "./spinner";

export interface RolePickerOption<Role extends string> {
	role: Role;
	title: string;
	description: string;
	art: ReactNode;
}

export interface RolePickerLabels {
	title: string;
	description: string;
	current: string;
	saving: string;
	error: string;
}

interface RolePickerProps<Role extends string> {
	options: RolePickerOption<Role>[];
	currentRole: Role | null;
	pendingRole: Role | null;
	hasError: boolean;
	labels: RolePickerLabels;
	onSelect: (role: Role) => void;
	headerActions?: ReactNode;
	footer?: ReactNode;
}

export function RolePicker<Role extends string>({
	options,
	currentRole,
	pendingRole,
	hasError,
	labels,
	onSelect,
	headerActions,
	footer,
}: RolePickerProps<Role>) {
	return (
		<div className="relative flex min-h-svh flex-col overflow-hidden bg-background text-foreground">
			<StarRiver className="opacity-40" />
			<header className="relative flex items-center justify-between gap-4 p-6 md:px-12">
				<IllapaLockup />
				{headerActions && (
					<div className="flex items-center gap-2">{headerActions}</div>
				)}
			</header>
			<main className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-6 pb-16">
				<div className="flex flex-col gap-4">
					<h1 className="type-title text-balance">{labels.title}</h1>
					<p className="type-lead text-muted-foreground">
						{labels.description}
					</p>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					{options.map((option) => {
						const isCurrent = option.role === currentRole;
						const isPending = option.role === pendingRole;
						return (
							<button
								key={option.role}
								type="button"
								aria-pressed={isCurrent}
								aria-busy={isPending}
								disabled={pendingRole !== null}
								onClick={() => onSelect(option.role)}
								className={cn(
									"group flex flex-col gap-5 rounded-xl border bg-card p-6 text-left text-card-foreground transition-colors",
									"hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
									"disabled:cursor-wait disabled:opacity-70",
									isCurrent && "border-primary",
								)}
							>
								<div className="flex items-start justify-between gap-4">
									<div className="grid size-20 place-items-center rounded-lg bg-muted">
										{option.art}
									</div>
									{isCurrent && (
										<span className="type-label rounded-full border border-primary px-2 py-1 text-primary">
											{labels.current}
										</span>
									)}
								</div>
								<div className="flex flex-col gap-2">
									<span className="type-heading">{option.title}</span>
									<span className="text-muted-foreground text-sm">
										{option.description}
									</span>
								</div>
								{isPending && (
									<span className="flex items-center gap-2 text-muted-foreground text-sm">
										<Spinner aria-hidden="true" />
										{labels.saving}
									</span>
								)}
							</button>
						);
					})}
				</div>
				{hasError && (
					<p role="alert" className="text-destructive text-sm">
						{labels.error}
					</p>
				)}
				{footer}
			</main>
		</div>
	);
}
