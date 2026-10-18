import { useRef } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "./alert-dialog";
import { Button } from "./button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./dialog";
import { Kbd } from "./kbd";
import type { StructureEditorLabels } from "./structure-editor-labels";

export function StructureEditorConfirmDialog({
	open: isOpen,
	title,
	description,
	action,
	labels,
	onOpenChange,
	onConfirm,
	destructive = true,
}: {
	open: boolean;
	title: string;
	description: string;
	action: string;
	labels: StructureEditorLabels;
	onOpenChange: (isOpen: boolean) => void;
	onConfirm: () => void;
	destructive?: boolean;
}) {
	const cancelRef = useRef<HTMLButtonElement>(null);
	return (
		<AlertDialog open={isOpen} onOpenChange={onOpenChange}>
			<AlertDialogContent
				initialFocus={cancelRef}
				className="motion-reduce:animate-none"
			>
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel ref={cancelRef}>{labels.cancel}</AlertDialogCancel>
					<AlertDialogAction
						variant={destructive ? "destructive" : "default"}
						onClick={onConfirm}
					>
						{action}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function StructureEditorShortcutsDialog({
	open: isOpen,
	labels,
	onOpenChange,
}: {
	open: boolean;
	labels: StructureEditorLabels;
	onOpenChange: (isOpen: boolean) => void;
}) {
	const shortcuts = [
		["1–8", labels.armShortcut],
		["Esc", labels.escapeShortcut],
		["Delete / ⌫", labels.deleteShortcut],
		["Ctrl / ⌘ + Z", labels.undo],
		["Ctrl / ⌘ + Shift + Z · Ctrl + Y", labels.redo],
		["W / E / R", `${labels.translate} / ${labels.rotate} / ${labels.scale}`],
		["F", labels.frame],
		["H", labels.overview],
		["N", labels.north],
		["?", labels.shortcuts],
	];
	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="motion-reduce:animate-none sm:max-w-lg"
			>
				<DialogHeader>
					<DialogTitle>{labels.shortcuts}</DialogTitle>
					<DialogDescription>{labels.canvas}</DialogDescription>
				</DialogHeader>
				<dl className="flex flex-col gap-3">
					{shortcuts.map(([key, action]) => (
						<div key={key} className="flex items-center justify-between gap-3">
							<dt className="text-sm">{action}</dt>
							<dd>
								<Kbd>{key}</Kbd>
							</dd>
						</div>
					))}
				</dl>
				<DialogFooter>
					<DialogClose render={<Button variant="outline" />}>
						{labels.close}
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
