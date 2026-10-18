export const STRUCTURE_KINDS = [
	"bridge",
	"tunnel",
	"bypass",
	"entity",
] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

export const STRUCTURE_PRIMITIVE_KINDS = [
	"block",
	"column",
	"beam",
	"slab",
	"wall",
] as const;
export type StructurePrimitiveKind = (typeof STRUCTURE_PRIMITIVE_KINDS)[number];

export const STRUCTURE_MATERIALS = [
	"concrete",
	"steel",
	"asphalt",
	"earth",
] as const;
export type StructureMaterial = (typeof STRUCTURE_MATERIALS)[number];

export const STRUCTURE_STATUSES = [
	"planned",
	"under_construction",
	"operational",
] as const;
export type StructureStatus = (typeof STRUCTURE_STATUSES)[number];

export const TUNNEL_SECTION_SHAPES = ["horseshoe", "circular"] as const;
export type TunnelSectionShape = (typeof TUNNEL_SECTION_SHAPES)[number];

export interface NumericRange {
	min: number;
	max: number;
	step: number;
	default: number;
}

export const BRIDGE_PARAMETERS = {
	deckWidthM: { min: 4, max: 30, step: 0.5, default: 10 },
	pierCount: { min: 0, max: 12, step: 1, default: 2 },
	defaultSpanM: 60,
	defaultDeckMaterial: "concrete",
} as const satisfies {
	deckWidthM: NumericRange;
	pierCount: NumericRange;
	defaultSpanM: number;
	defaultDeckMaterial: StructureMaterial;
};

export const TUNNEL_PARAMETERS = {
	sectionWidthM: { min: 6, max: 20, step: 0.5, default: 10 },
	sectionHeightM: { min: 5, max: 12, step: 0.5, default: 7 },
	defaultLengthM: 200,
	defaultShape: "horseshoe",
} as const satisfies {
	sectionWidthM: NumericRange;
	sectionHeightM: NumericRange;
	defaultLengthM: number;
	defaultShape: TunnelSectionShape;
};

export const BYPASS_PARAMETERS = {
	laneCount: { min: 1, max: 4, step: 1, default: 2 },
	laneWidthM: { min: 2.75, max: 3.6, step: 0.05, default: 3.3 },
	defaultLengthM: 300,
	minPointCount: 2,
} as const satisfies {
	laneCount: NumericRange;
	laneWidthM: NumericRange;
	defaultLengthM: number;
	minPointCount: number;
};

export interface PrimitiveDefaults {
	widthM: number;
	heightM: number;
	depthM: number;
	material: StructureMaterial;
}

export const PRIMITIVE_DEFAULTS: Record<
	StructurePrimitiveKind,
	PrimitiveDefaults
> = {
	block: { widthM: 4, heightM: 4, depthM: 4, material: "concrete" },
	column: { widthM: 1.2, heightM: 8, depthM: 1.2, material: "concrete" },
	beam: { widthM: 12, heightM: 1.2, depthM: 0.8, material: "steel" },
	slab: { widthM: 10, heightM: 0.4, depthM: 10, material: "concrete" },
	wall: { widthM: 10, heightM: 3, depthM: 0.4, material: "concrete" },
};

export const PRIMITIVE_SIZE_RANGE_M = {
	min: 0.2,
	max: 200,
	step: 0.1,
} as const;
