import type { SceneStructure } from "../lib/structure-scene";
import { cn } from "../lib/utils";
import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Badge } from "./badge";
import { Button } from "./button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./empty";
import { Separator } from "./separator";
import { Skeleton } from "./skeleton";
import { StructureArt } from "./structure-art";
import type { StructureEditorLabels } from "./structure-editor-labels";

interface StructureEditorListProps {
	structures: SceneStructure[];
	selectedId: string | null;
	loading: boolean;
	failed: boolean;
	labels: StructureEditorLabels;
	onSelect: (id: string) => void;
	onHover: (id: string | null) => void;
	onRetry: () => void;
}

export function StructureEditorList({
	structures,
	selectedId,
	loading,
	failed,
	labels,
	onSelect,
	onHover,
	onRetry,
}: StructureEditorListProps) {
	return (
		<section
			className="flex min-h-0 flex-1 flex-col"
			aria-label={labels.structures}
		>
			<Separator />
			<h2 className="type-label p-3">
				{labels.structures} · {structures.length}
			</h2>
			<div
				className="min-h-0 flex-1 overflow-y-auto p-2 pt-0"
				aria-busy={loading}
			>
				{loading ? (
					<div
						role="status"
						className="flex flex-col gap-2"
						aria-label={labels.loading}
					>
						{["first", "second", "third"].map((key) => (
							<Skeleton
								key={key}
								className="h-14 w-full motion-reduce:animate-none"
							/>
						))}
					</div>
				) : failed ? (
					<Alert variant="destructive">
						<AlertTitle>{labels.listError}</AlertTitle>
						<AlertDescription>
							{labels.listErrorDetail}
							<Button variant="outline" size="sm" onClick={onRetry}>
								{labels.retry}
							</Button>
						</AlertDescription>
					</Alert>
				) : !structures.length ? (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>{labels.empty}</EmptyTitle>
							<EmptyDescription>{labels.emptyDetail}</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<ul className="flex flex-col gap-1">
						{structures.map((structure) => (
							<li key={structure.id}>
								<button
									type="button"
									aria-current={
										selectedId === structure.id ? "true" : undefined
									}
									onMouseEnter={() => onHover(structure.id)}
									onMouseLeave={() => onHover(null)}
									onFocus={() => onHover(structure.id)}
									onBlur={() => onHover(null)}
									onClick={() => onSelect(structure.id)}
									className={cn(
										"flex w-full items-center gap-2 rounded-sm border-l-2 border-l-transparent p-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
										selectedId === structure.id && "border-l-primary bg-accent",
									)}
								>
									<StructureArt
										kind={
											structure.template.kind === "entity"
												? (structure.elements[0]?.kind ?? "block")
												: structure.template.kind
										}
										label={labels[structure.template.kind]}
										className="size-8 shrink-0"
									/>
									<span className="flex min-w-0 flex-1 flex-col gap-1">
										<span className="truncate font-medium text-sm">
											{structure.name}
										</span>
										<span className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
											{labels[structure.template.kind]} ·{" "}
											<Badge variant="outline">
												{labels[structure.status]}
											</Badge>
										</span>
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}
