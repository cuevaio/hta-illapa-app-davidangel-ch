import {
	STRUCTURE_PRIMITIVE_KINDS,
	type StructureKind,
	type StructurePrimitiveKind,
} from "@hack-the-andes-project/business/structures/catalog";
import { cn } from "cn";
import {
	STRUCTURE_ART_PRIMITIVE_STROKE_WIDTH_PX,
	STRUCTURE_ART_STROKE_WIDTH_PX,
	STRUCTURE_ART_VIEWBOX_PX,
} from "../lib/constants";

interface StructureArtProps {
	kind: Exclude<StructureKind, "entity"> | StructurePrimitiveKind;
	label?: string;
	className?: string;
}

interface StructureArtPath {
	path: string;
	className: string;
	strokeDasharray?: string;
}

const STRUCTURE_ART_GROUND_PATHS_PX: readonly StructureArtPath[] = [
	{
		path: "M7.74 83.04L64.00 115.52L64.00 120.00L7.74 87.52Z",
		className: "fill-muted",
	},
	{
		path: "M64.00 115.52L120.26 83.04L120.26 87.52L64.00 120.00Z",
		className: "fill-muted-foreground/20",
	},
	{
		path: "M64.00 50.56L120.26 83.04L64.00 115.52L7.74 83.04Z",
		className: "fill-muted/60",
	},
];

const STRUCTURE_ART_PATHS_PX: Record<
	StructureArtProps["kind"],
	readonly StructureArtPath[]
> = {
	bridge: [
		{
			path: "M84.37 62.32L99.89 71.28L43.63 103.76L28.11 94.80Z",
			className: "fill-brand-river/65 stroke-brand-river/30",
		},
		{
			path: "M41.69 91.44L48.48 95.36M80.49 70.16L87.28 74.08",
			className: "fill-none stroke-card/60",
		},
		{
			path: "M33.93 71.28L43.63 76.88L43.63 45.52L33.93 39.92Z",
			className: "fill-muted-foreground/35",
		},
		{
			path: "M43.63 76.88L53.33 71.28L53.33 39.92L43.63 45.52Z",
			className: "fill-muted-foreground/65",
		},
		{
			path: "M43.63 34.32L53.33 39.92L43.63 45.52L33.93 39.92Z",
			className: "fill-card",
		},
		{
			path: "M74.67 94.80L84.37 100.40L84.37 69.04L74.67 63.44Z",
			className: "fill-muted-foreground/35",
		},
		{
			path: "M84.37 100.40L94.07 94.80L94.07 63.44L84.37 69.04Z",
			className: "fill-muted-foreground/65",
		},
		{
			path: "M84.37 57.84L94.07 63.44L84.37 69.04L74.67 63.44Z",
			className: "fill-card",
		},
		{
			path: "M12.59 34.32L94.07 81.36L94.07 76.88L12.59 29.84Z",
			className: "fill-muted-foreground/35",
		},
		{
			path: "M94.07 81.36L115.41 69.04L115.41 64.56L94.07 76.88Z",
			className: "fill-muted-foreground/65",
		},
		{
			path: "M33.93 17.52L115.41 64.56L94.07 76.88L12.59 29.84Z",
			className: "fill-card",
		},
		{
			path: "M31.02 19.20L112.50 66.24L96.98 75.20L15.50 28.16Z",
			className: "fill-muted-foreground/80",
		},
		{
			path: "M26.17 25.36L101.83 69.04",
			className: "fill-none stroke-card",
			strokeDasharray: "4 5",
		},
		{
			path: "M33.93 13.04L115.41 60.08M12.59 25.36L94.07 72.40",
			className: "fill-none stroke-muted-foreground",
		},
		{
			path: "M37.81 19.76L37.81 15.28M16.47 32.08L16.47 27.60M74.67 41.04L74.67 36.56M53.33 53.36L53.33 48.88M111.53 62.32L111.53 57.84M90.19 74.64L90.19 70.16",
			className: "fill-none stroke-muted-foreground",
		},
	],
	tunnel: [
		{
			path: "M44.60 40.48L83.40 18.08L110.56 87.52L71.76 109.92Z",
			className: "fill-muted",
		},
		{
			path: "M44.60 40.48L71.76 109.92L44.60 94.24Z",
			className: "fill-muted-foreground/45",
		},
		{
			path: "M44.60 40.48L44.60 94.24L17.44 78.56Z",
			className: "fill-muted-foreground/25",
		},
		{
			path: "M34.90 81.92L34.90 66.24C34.90 44.96 65.94 62.88 65.94 84.16L65.94 99.84Z",
			className: "fill-muted-foreground/65",
		},
		{
			path: "M32.96 87.52L32.96 71.84C32.96 56.16 56.24 69.60 56.24 85.28L56.24 100.96Z",
			className: "fill-foreground/90",
		},
		{
			path: "M26.17 93.34L45.57 104.54L60.12 96.14L40.72 84.94Z",
			className: "fill-muted-foreground/80",
		},
		{
			path: "M35.87 98.83L49.45 90.99",
			className: "fill-none stroke-card",
			strokeDasharray: "4 5",
		},
		{
			path: "M29.08 85.28L29.08 69.60C29.08 48.32 60.12 66.24 60.12 87.52L60.12 103.20ZM33.93 88.08L33.93 72.40C33.93 57.84 55.27 70.16 55.27 84.72L55.27 100.40Z",
			className: "fill-card",
		},
		{
			path: "M55.27 100.40L55.27 84.72C55.27 74.64 50.42 67.36 44.60 64.00C60.12 66.24 61.09 71.28 61.09 81.36L61.09 97.04Z",
			className: "fill-muted-foreground/75",
		},
	],
	bypass: [
		{
			path: "M31.99 68.48C37.81 83.04 42.66 90.32 55.27 93.12C69.82 97.04 81.46 92.56 99.89 70.72L111.53 77.44C95.04 100.40 73.70 110.48 49.45 103.20C32.96 98.16 26.17 89.76 20.35 75.20Z",
			className: "fill-muted-foreground/80",
		},
		{
			path: "M26.17 71.73C31.99 86.29 37.81 94.13 52.36 98.05C71.76 103.65 88.25 96.37 105.71 73.97",
			className: "fill-none stroke-card",
			strokeDasharray: "4 5",
		},
		{
			path: "M64.97 56.72L64.97 32.64L34.90 74.08Z",
			className: "fill-muted-foreground/25",
		},
		{
			path: "M64.97 32.64L95.04 74.08L64.97 91.44Z",
			className: "fill-muted",
		},
		{
			path: "M34.90 74.08L64.97 32.64L64.97 91.44Z",
			className: "fill-muted-foreground/45",
		},
	],
	block: [
		{
			path: "M21.32 83.04L64.00 107.68L64.00 69.60L21.32 44.96Z",
			className: "fill-muted-foreground/35",
		},
		{
			path: "M64.00 107.68L106.68 83.04L106.68 44.96L64.00 69.60Z",
			className: "fill-muted-foreground/65",
		},
		{
			path: "M64.00 20.32L106.68 44.96L64.00 69.60L21.32 44.96Z",
			className: "fill-card",
		},
	],
	column: [
		{
			path: "M40.73 24.80L40.73 83.04A23.27 13.44 0 0 0 64 96.48L64 38.24A23.27 13.44 0 0 1 40.73 24.80Z",
			className: "fill-muted-foreground/35",
		},
		{
			path: "M64 38.24L64 96.48A23.27 13.44 0 0 0 87.27 83.04L87.27 24.80A23.27 13.44 0 0 1 64 38.24Z",
			className: "fill-muted-foreground/65",
		},
		{
			path: "M40.73 24.80A23.27 13.44 0 1 1 87.27 24.80A23.27 13.44 0 1 1 40.73 24.80Z",
			className: "fill-card",
		},
	],
	beam: [
		{
			path: "M12.59 62.32L99.89 112.72L99.89 92.56L12.59 42.16Z",
			className: "fill-muted-foreground/35",
		},
		{
			path: "M99.89 112.72L115.41 103.76L115.41 83.60L99.89 92.56Z",
			className: "fill-muted-foreground/65",
		},
		{
			path: "M28.11 33.20L115.41 83.60L99.89 92.56L12.59 42.16Z",
			className: "fill-card",
		},
	],
	slab: [
		{
			path: "M11.62 83.04L64.00 113.28L64.00 106.56L11.62 76.32Z",
			className: "fill-muted-foreground/35",
		},
		{
			path: "M64.00 113.28L116.38 83.04L116.38 76.32L64.00 106.56Z",
			className: "fill-muted-foreground/65",
		},
		{
			path: "M64.00 46.08L116.38 76.32L64.00 106.56L11.62 76.32Z",
			className: "fill-card",
		},
	],
	wall: [
		{
			path: "M19.87 62.60L99.40 108.52L99.40 65.96L19.87 20.04Z",
			className: "fill-muted-foreground/35",
		},
		{
			path: "M99.40 108.52L108.13 103.48L108.13 60.92L99.40 65.96Z",
			className: "fill-muted-foreground/65",
		},
		{
			path: "M28.60 15.00L108.13 60.92L99.40 65.96L19.87 20.04Z",
			className: "fill-card",
		},
	],
};

export function StructureArt({ kind, label, className }: StructureArtProps) {
	const hasLabel = Boolean(label);

	return (
		<svg
			viewBox={STRUCTURE_ART_VIEWBOX_PX}
			className={cn("size-12 shrink-0 stroke-border", className)}
			role={hasLabel ? "img" : undefined}
			aria-label={label}
			aria-hidden={hasLabel ? undefined : true}
			focusable="false"
			fillRule="evenodd"
			strokeWidth={STRUCTURE_ART_STROKE_WIDTH_PX}
			strokeLinejoin="round"
			strokeLinecap="round"
		>
			{hasLabel ? <title>{label}</title> : null}
			{STRUCTURE_ART_GROUND_PATHS_PX.map((groundPath) => (
				<path
					key={groundPath.path}
					d={groundPath.path}
					className={groundPath.className}
				/>
			))}
			<g
				strokeWidth={
					STRUCTURE_PRIMITIVE_KINDS.some(
						(primitiveKind) => primitiveKind === kind,
					)
						? STRUCTURE_ART_PRIMITIVE_STROKE_WIDTH_PX
						: undefined
				}
			>
				{STRUCTURE_ART_PATHS_PX[kind].map((artworkPath) => (
					<path
						key={artworkPath.path}
						d={artworkPath.path}
						className={artworkPath.className}
						strokeDasharray={artworkPath.strokeDasharray}
					/>
				))}
			</g>
		</svg>
	);
}
