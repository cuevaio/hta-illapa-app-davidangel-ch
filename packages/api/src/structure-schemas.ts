import {
	BRIDGE_PARAMETERS,
	BYPASS_PARAMETERS,
	type NumericRange,
	PRIMITIVE_SIZE_RANGE_M,
	STRUCTURE_MATERIALS,
	STRUCTURE_PRIMITIVE_KINDS,
	STRUCTURE_STATUSES,
	TUNNEL_PARAMETERS,
	TUNNEL_SECTION_SHAPES,
} from "@hack-the-andes-project/business/structures/catalog";
import {
	MAX_BYPASS_POINTS,
	MAX_ROTATION_DEG,
	MAX_STRUCTURE_ELEMENTS,
	MAX_STRUCTURE_ELEVATION_M,
	MAX_STRUCTURE_EXTENT_M,
	MAX_STRUCTURE_NOTES_LENGTH_CHARS,
	MIN_STRUCTURE_ELEVATION_M,
} from "@hack-the-andes-project/business/structures/constants";
import { USER_ROLES } from "@hack-the-andes-project/db/schema/auth";
import { z } from "zod";

import { fleetIdSchema, fleetNameSchema, latLngSchema } from "./schemas";

export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof userRoleSchema>;

function rangeSchema(range: NumericRange) {
	return z.number().min(range.min).max(range.max);
}

const localCoordinateSchema = z
	.number()
	.min(-MAX_STRUCTURE_EXTENT_M)
	.max(MAX_STRUCTURE_EXTENT_M);

const rotationSchema = z.number().min(-MAX_ROTATION_DEG).max(MAX_ROTATION_DEG);

const primitiveSizeSchema = z
	.number()
	.min(PRIMITIVE_SIZE_RANGE_M.min)
	.max(PRIMITIVE_SIZE_RANGE_M.max);

// Local metres from the anchor in the terrain frame: +x east, +y up, -z north.
export const structurePointSchema = z.object({
	x: localCoordinateSchema,
	y: localCoordinateSchema,
	z: localCoordinateSchema,
});

export const structureAnchorSchema = latLngSchema.extend({
	elevationM: z
		.number()
		.min(MIN_STRUCTURE_ELEVATION_M)
		.max(MAX_STRUCTURE_ELEVATION_M),
});

export const bridgeTemplateSchema = z.object({
	kind: z.literal("bridge"),
	start: structurePointSchema,
	end: structurePointSchema,
	deckWidthM: rangeSchema(BRIDGE_PARAMETERS.deckWidthM),
	pierCount: rangeSchema(BRIDGE_PARAMETERS.pierCount).int(),
	deckMaterial: z.enum(STRUCTURE_MATERIALS),
});

export const tunnelTemplateSchema = z.object({
	kind: z.literal("tunnel"),
	start: structurePointSchema,
	end: structurePointSchema,
	sectionWidthM: rangeSchema(TUNNEL_PARAMETERS.sectionWidthM),
	sectionHeightM: rangeSchema(TUNNEL_PARAMETERS.sectionHeightM),
	shape: z.enum(TUNNEL_SECTION_SHAPES),
});

export const bypassTemplateSchema = z.object({
	kind: z.literal("bypass"),
	points: z
		.array(structurePointSchema)
		.min(BYPASS_PARAMETERS.minPointCount)
		.max(MAX_BYPASS_POINTS),
	laneCount: rangeSchema(BYPASS_PARAMETERS.laneCount).int(),
	laneWidthM: rangeSchema(BYPASS_PARAMETERS.laneWidthM),
});

export const entityTemplateSchema = z.object({
	kind: z.literal("entity"),
});

export const structureTemplateSchema = z.discriminatedUnion("kind", [
	bridgeTemplateSchema,
	tunnelTemplateSchema,
	bypassTemplateSchema,
	entityTemplateSchema,
]);

export const structureElementSchema = z.object({
	id: fleetIdSchema,
	kind: z.enum(STRUCTURE_PRIMITIVE_KINDS),
	material: z.enum(STRUCTURE_MATERIALS),
	position: structurePointSchema,
	rotationDeg: z.object({
		x: rotationSchema,
		y: rotationSchema,
		z: rotationSchema,
	}),
	widthM: primitiveSizeSchema,
	heightM: primitiveSizeSchema,
	depthM: primitiveSizeSchema,
});

export const structureFieldsSchema = z.object({
	name: fleetNameSchema,
	status: z.enum(STRUCTURE_STATUSES),
	notes: z.string().max(MAX_STRUCTURE_NOTES_LENGTH_CHARS),
	anchor: structureAnchorSchema,
	template: structureTemplateSchema,
	elements: z.array(structureElementSchema).max(MAX_STRUCTURE_ELEMENTS),
});

export const structureSchema = structureFieldsSchema.extend({
	id: fleetIdSchema,
	createdAt: z.date(),
	updatedAt: z.date(),
});

// The client mints the id so a retried or restored create is idempotent.
export const structureInputSchema = structureFieldsSchema.extend({
	id: fleetIdSchema,
});

export interface StructurePoint extends z.infer<typeof structurePointSchema> {}
export interface StructureAnchor
	extends z.infer<typeof structureAnchorSchema> {}
export interface BridgeTemplate extends z.infer<typeof bridgeTemplateSchema> {}
export interface TunnelTemplate extends z.infer<typeof tunnelTemplateSchema> {}
export interface BypassTemplate extends z.infer<typeof bypassTemplateSchema> {}
export interface EntityTemplate extends z.infer<typeof entityTemplateSchema> {}
export type StructureTemplate =
	| BridgeTemplate
	| TunnelTemplate
	| BypassTemplate
	| EntityTemplate;
export interface StructureElement
	extends z.infer<typeof structureElementSchema> {}
export interface StructureFields
	extends z.infer<typeof structureFieldsSchema> {}
export interface Structure extends z.infer<typeof structureSchema> {}
export interface StructureInput extends z.infer<typeof structureInputSchema> {}
