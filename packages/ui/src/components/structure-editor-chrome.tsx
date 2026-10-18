import { TERRAIN_ATTRIBUTION } from "@hack-the-andes-project/terrain";
import {
	CompassIcon,
	HouseIcon,
	KeyboardIcon,
	Redo2Icon,
	ShapesIcon,
	Undo2Icon,
	ViewIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { PrimitiveTarget } from "../lib/structure-scene";
import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Button } from "./button";
import { Kbd } from "./kbd";
import { StructureArt } from "./structure-art";
import type { StructureEditorLabels } from "./structure-editor-labels";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export function StructureEditorNavigationIcon() {
	return <ShapesIcon />;
}

interface StructureEditorHeaderProps {
	labels: StructureEditorLabels;
	status: string;
	canUndo: boolean;
	canRedo: boolean;
	xrAvailable: boolean;
	xrReason: string;
	onUndo: () => void;
	onRedo: () => void;
	onEnterXr: () => void;
	children?: ReactNode;
}

export function StructureEditorHeader({
	labels,
	status,
	canUndo,
	canRedo,
	xrAvailable,
	xrReason,
	onUndo,
	onRedo,
	onEnterXr,
	children,
}: StructureEditorHeaderProps) {
	return (
		<header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
			{children}
			<h1 className="type-heading min-w-0 flex-1 truncate">{labels.title}</h1>
			<div className="hidden items-center gap-2 lg:flex">
				<span role="status" className="type-data mr-2 text-muted-foreground">
					{status}
				</span>
				<Button
					variant="outline"
					size="sm"
					disabled={!canUndo}
					onClick={onUndo}
				>
					<Undo2Icon data-icon="inline-start" />
					{labels.undo}
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={!canRedo}
					onClick={onRedo}
				>
					<Redo2Icon data-icon="inline-start" />
					{labels.redo}
				</Button>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-disabled={!xrAvailable}
								className="aria-disabled:opacity-50"
								onClick={() => {
									if (xrAvailable) onEnterXr();
								}}
							/>
						}
					>
						<ViewIcon data-icon="inline-start" />
						{labels.xr}
					</TooltipTrigger>
					<TooltipContent>{xrReason}</TooltipContent>
				</Tooltip>
			</div>
		</header>
	);
}

export function StructureEditorCameraControls({
	labels,
	onNorth,
	onOverview,
	onShortcuts,
}: {
	labels: StructureEditorLabels;
	onNorth: () => void;
	onOverview: () => void;
	onShortcuts: () => void;
}) {
	return (
		<div className="pointer-events-auto flex self-end rounded-lg border bg-card p-1">
			{[
				{
					label: labels.north,
					shortcut: "N",
					Icon: CompassIcon,
					onClick: onNorth,
				},
				{
					label: labels.overview,
					shortcut: "H",
					Icon: HouseIcon,
					onClick: onOverview,
				},
				{
					label: labels.shortcuts,
					shortcut: "?",
					Icon: KeyboardIcon,
					onClick: onShortcuts,
				},
			].map(({ label, shortcut, Icon, onClick }) => (
				<Tooltip key={shortcut}>
					<TooltipTrigger
						render={
							<Button
								variant="ghost"
								size="icon-lg"
								aria-label={label}
								aria-keyshortcuts={shortcut}
								onClick={onClick}
							/>
						}
					>
						<Icon />
					</TooltipTrigger>
					<TooltipContent>
						{label} <Kbd>{shortcut}</Kbd>
					</TooltipContent>
				</Tooltip>
			))}
		</div>
	);
}

interface StructureEditorBannerProps {
	title: string;
	description: string;
	labels: StructureEditorLabels;
	selectedName: string | null;
	primitiveTarget: PrimitiveTarget;
	onPrimitiveTarget: (target: PrimitiveTarget) => void;
	onCancel: () => void;
}

export function StructureEditorBanner({
	title,
	description,
	labels,
	selectedName,
	primitiveTarget,
	onPrimitiveTarget,
	onCancel,
}: StructureEditorBannerProps) {
	return (
		<Alert className="pointer-events-auto w-full max-w-120">
			<AlertTitle className="type-label">{title}</AlertTitle>
			<AlertDescription>
				{selectedName && (
					<fieldset className="flex flex-wrap gap-3">
						<legend className="mb-1 font-medium">{labels.addTo}</legend>
						<label className="flex items-center gap-1">
							<input
								type="radio"
								name="primitive-target"
								checked={primitiveTarget === "selection"}
								onChange={() => onPrimitiveTarget("selection")}
							/>
							{selectedName}
						</label>
						<label className="flex items-center gap-1">
							<input
								type="radio"
								name="primitive-target"
								checked={primitiveTarget === "new_entity"}
								onChange={() => onPrimitiveTarget("new_entity")}
							/>
							{labels.newEntity}
						</label>
					</fieldset>
				)}
				<p>{description}</p>
				<Button variant="outline" size="sm" onClick={onCancel}>
					{labels.cancel} <Kbd>Esc</Kbd>
				</Button>
			</AlertDescription>
		</Alert>
	);
}

export function StructureEditorNotice({
	title,
	detail,
	action,
	onAction,
	destructive = false,
}: {
	title: string;
	detail: string;
	action?: string;
	onAction?: () => void;
	destructive?: boolean;
}) {
	return (
		<Alert
			variant={destructive ? "destructive" : "default"}
			className="pointer-events-auto w-full max-w-120"
		>
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>
				<p>{detail}</p>
				{action && (
					<Button variant="outline" size="sm" onClick={onAction}>
						{action}
					</Button>
				)}
			</AlertDescription>
		</Alert>
	);
}

export function StructureEditorPhoneNotice({
	labels,
	onCopy,
}: {
	labels: StructureEditorLabels;
	onCopy: () => void;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto p-6 text-center">
			<StructureArt kind="bridge" label={labels.bridge} className="size-36" />
			<h2 className="type-heading max-w-sm">{labels.phoneTitle}</h2>
			<p className="type-body max-w-sm text-muted-foreground">
				{labels.phoneDetail}
			</p>
			<Button variant="outline" onClick={onCopy}>
				{labels.copyLink}
			</Button>
		</div>
	);
}

export function StructureEditorAttribution({
	cursor,
	heightPx,
}: {
	cursor: string | null;
	heightPx: number;
}) {
	return (
		<div
			style={{ height: heightPx }}
			className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 border-t bg-background/95 px-3"
		>
			<span className="type-data truncate text-muted-foreground">{cursor}</span>
			<span className="type-data shrink-0 text-muted-foreground">
				{TERRAIN_ATTRIBUTION}
			</span>
		</div>
	);
}
