import type { ReactNode } from "react";
import { BellIcon, MapIcon, TruckIcon } from "./icons";
import { IllapaLockup } from "./illapa-logo";
import { RainStreaks, StarRiver } from "./mayu-art";

export interface AuthHighlightLabels {
	title: string;
	description: string;
}

export interface AuthShellLabels {
	headline: string;
	tagline: string;
	liveIncidents: AuthHighlightLabels;
	fleetArrival: AuthHighlightLabels;
	rerouteAlerts: AuthHighlightLabels;
	sources: string;
}

export interface AuthShellProps {
	children: ReactNode;
	labels: AuthShellLabels;
	headerActions?: ReactNode;
}

export function AuthShell({ children, labels, headerActions }: AuthShellProps) {
	const highlights = [
		{ icon: MapIcon, ...labels.liveIncidents },
		{ icon: TruckIcon, ...labels.fleetArrival },
		{ icon: BellIcon, ...labels.rerouteAlerts },
	];

	return (
		<div className="grid min-h-svh lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
			<aside className="dark relative hidden overflow-hidden border-border border-r bg-background p-12 text-foreground lg:flex lg:flex-col lg:justify-between lg:gap-12">
				<StarRiver className="opacity-50" />
				<RainStreaks className="text-foreground/10" />
				<IllapaLockup className="relative" />
				<div className="relative max-w-lg">
					<h1 className="type-title text-balance">{labels.headline}</h1>
					<p className="type-lead mt-6 text-muted-foreground">
						{labels.tagline}
					</p>
					<ul className="mt-12 flex flex-col gap-7">
						{highlights.map(({ icon: Icon, title, description }) => (
							<li key={title} className="flex gap-4">
								<span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-foreground">
									<Icon aria-hidden className="size-4" />
								</span>
								<div>
									<p className="font-medium font-sans text-sm">{title}</p>
									<p className="type-body mt-2 text-pretty text-muted-foreground">
										{description}
									</p>
								</div>
							</li>
						))}
					</ul>
				</div>
				<p className="type-body relative text-muted-foreground">
					{labels.sources}
				</p>
			</aside>
			<main className="flex min-w-0 flex-col bg-background px-6 py-8 text-foreground sm:px-10">
				<div className="flex flex-wrap items-center justify-between gap-4 lg:justify-end">
					<div className="lg:hidden">
						<IllapaLockup className="relative" />
					</div>
					{headerActions && (
						<div className="ml-auto flex items-center gap-2">
							{headerActions}
						</div>
					)}
				</div>
				<div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
					{children}
				</div>
			</main>
		</div>
	);
}
