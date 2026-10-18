import type {
	StructureKind,
	StructurePrimitiveKind,
} from "@hack-the-andes-project/business/structures/catalog";
import type { PlacementTool } from "@hack-the-andes-project/ui/lib/structure-scene";

interface StructurePaletteDefinition {
	id: Exclude<StructureKind, "entity"> | StructurePrimitiveKind;
	shortcut: string;
	tool: PlacementTool;
}
export const STRUCTURE_PALETTE_TOOLS: StructurePaletteDefinition[] = [
	{ id: "bridge", shortcut: "1", tool: { kind: "bridge" } },
	{ id: "tunnel", shortcut: "2", tool: { kind: "tunnel" } },
	{ id: "bypass", shortcut: "3", tool: { kind: "bypass" } },
	{ id: "block", shortcut: "4", tool: { primitive: "block" } },
	{ id: "column", shortcut: "5", tool: { primitive: "column" } },
	{ id: "beam", shortcut: "6", tool: { primitive: "beam" } },
	{ id: "slab", shortcut: "7", tool: { primitive: "slab" } },
	{ id: "wall", shortcut: "8", tool: { primitive: "wall" } },
];
