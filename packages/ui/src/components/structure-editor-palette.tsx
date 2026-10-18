import type { PlacementTool } from "../lib/structure-scene";
import { cn } from "../lib/utils";
import { Kbd } from "./kbd";
import { StructureArt } from "./structure-art";
import type { StructureEditorLabels } from "./structure-editor-labels";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export interface StructurePaletteItem {
	id: string;
	label: string;
	shortcut: string;
	tool: PlacementTool;
	armed: boolean;
}

interface StructureEditorPaletteProps {
	items: StructurePaletteItem[];
	labels: StructureEditorLabels;
	disabledReason: string | null;
	onArm: (tool: PlacementTool) => void;
}

export function StructureEditorPalette({
	items,
	labels,
	disabledReason,
	onArm,
}: StructureEditorPaletteProps) {
	return (
		<section className="flex flex-col gap-3 p-3" aria-label={labels.add}>
			<h2 className="type-label">{labels.add}</h2>
			{[labels.templates, labels.primitives].map((heading, groupIndex) => (
				<div key={heading} className="flex flex-col gap-2">
					<h3 className="type-label text-muted-foreground">{heading}</h3>
					<div
						className={cn(
							"grid",
							groupIndex === 0
								? "grid-cols-3 gap-1.5"
								: "grid-cols-[repeat(5,minmax(max-content,1fr))] gap-1",
						)}
					>
						{items
							.filter((item) =>
								groupIndex === 0
									? "kind" in item.tool
									: "primitive" in item.tool,
							)
							.map((item) => (
								<Tooltip key={item.id}>
									<TooltipTrigger
										render={
											<button
												type="button"
												aria-pressed={item.armed}
												aria-label={item.label}
												aria-disabled={Boolean(disabledReason)}
												aria-keyshortcuts={item.shortcut}
												className={cn(
													"relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-md border border-border bg-card py-2 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
													groupIndex === 0
														? "min-h-24 px-1"
														: "min-h-16 px-0.5",
													item.armed && "bg-accent ring-2 ring-ring",
													disabledReason && "opacity-50",
												)}
												onClick={() => {
													if (!disabledReason) onArm(item.tool);
												}}
											/>
										}
									>
										<StructureArt
											kind={
												"kind" in item.tool
													? item.tool.kind
													: item.tool.primitive
											}
											label={item.label}
											className={groupIndex === 0 ? "size-14" : "size-7"}
										/>
										<span
											className={
												groupIndex === 0
													? "max-w-full truncate"
													: "whitespace-nowrap"
											}
										>
											{item.label}
										</span>
										<Kbd className="absolute top-1 right-1">
											{item.shortcut}
										</Kbd>
									</TooltipTrigger>
									<TooltipContent>
										{disabledReason ?? item.label}
									</TooltipContent>
								</Tooltip>
							))}
					</div>
				</div>
			))}
		</section>
	);
}
