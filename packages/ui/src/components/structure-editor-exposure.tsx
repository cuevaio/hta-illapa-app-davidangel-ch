import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Badge } from "./badge";
import { Button } from "./button";
import { Skeleton } from "./skeleton";
import type { StructureEditorLabels } from "./structure-editor-labels";

export interface StructureExposureRow {
	id: string;
	title: string;
	severity: "critical" | "warning" | "info";
	severityLabel: string;
	distance: string;
	source: string;
}

export function StructureEditorExposure({
	rows,
	lead,
	source,
	loading,
	failed,
	labels,
	onRetry,
	onFocus,
}: {
	rows: StructureExposureRow[];
	lead: string;
	source: string;
	loading: boolean;
	failed: boolean;
	labels: StructureEditorLabels;
	onRetry: () => void;
	onFocus: (id: string) => void;
}) {
	return (
		<section className="flex flex-col gap-3" aria-busy={loading}>
			{loading ? (
				<Skeleton
					role="status"
					className="h-20 w-full motion-reduce:animate-none"
					aria-label={labels.loading}
				/>
			) : failed ? (
				<Alert variant="destructive">
					<AlertTitle>{labels.exposureError}</AlertTitle>
					<AlertDescription>
						<Button variant="outline" size="sm" onClick={onRetry}>
							{labels.retry}
						</Button>
					</AlertDescription>
				</Alert>
			) : (
				<>
					<h3 className="font-medium text-sm">{lead}</h3>
					<p className="type-data text-muted-foreground">{source}</p>
					<ul className="flex flex-col gap-2">
						{rows.map((row) => (
							<li key={row.id}>
								<button
									type="button"
									className="flex w-full flex-col gap-2 rounded-md border p-3 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
									onClick={() => onFocus(row.id)}
								>
									<span className="flex w-full items-center justify-between gap-2">
										<Badge
											variant={
												row.severity === "warning" ? "high" : row.severity
											}
										>
											{row.severityLabel}
										</Badge>
										<span className="type-data">{row.distance}</span>
									</span>
									<span className="font-medium text-sm">{row.title}</span>
									<span className="type-data text-muted-foreground">
										{row.source}
									</span>
								</button>
							</li>
						))}
					</ul>
				</>
			)}
		</section>
	);
}
