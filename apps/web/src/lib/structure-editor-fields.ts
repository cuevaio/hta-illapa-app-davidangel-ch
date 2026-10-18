import { fleetNameSchema } from "@hack-the-andes-project/api/schemas";
import {
	BRIDGE_PARAMETERS,
	BYPASS_PARAMETERS,
	PRIMITIVE_SIZE_RANGE_M,
	STRUCTURE_MATERIALS,
	STRUCTURE_STATUSES,
	TUNNEL_PARAMETERS,
	TUNNEL_SECTION_SHAPES,
} from "@hack-the-andes-project/business/structures/catalog";
import { MAX_STRUCTURE_NOTES_LENGTH_CHARS } from "@hack-the-andes-project/business/structures/constants";
import {
	formatStructureLength,
	structureLengthM,
} from "@hack-the-andes-project/business/structures/geometry";
import type { StructureEditorLabels } from "@hack-the-andes-project/ui/components/structure-editor-labels";
import type { StructureEditorField } from "@hack-the-andes-project/ui/components/structure-editor-parameters";
import type {
	SceneStructure,
	StructureElement,
} from "@hack-the-andes-project/ui/lib/structure-scene";
import {
	ENGINEERING_COORDINATE_DIGITS,
	ENGINEERING_ELEVATION_FRACTION_DIGITS,
} from "../constants";
import { m } from "../paraglide/messages";

export function structureEditorFields(
	selectedStructure: SceneStructure,
	selectedElement: StructureElement | undefined,
	labels: StructureEditorLabels,
	locale: string,
	onChange: (selectedStructure: SceneStructure, action: string) => void,
): StructureEditorField[] {
	const materialOptions = STRUCTURE_MATERIALS.map((value) => ({
		value,
		label: labels[value],
	}));
	const elevationFormatter = new Intl.NumberFormat(locale, {
		maximumFractionDigits: ENGINEERING_ELEVATION_FRACTION_DIGITS,
	});
	if (selectedElement) {
		const updateElement = (updated: StructureElement, label: string) =>
			onChange(
				{
					...selectedStructure,
					elements: selectedStructure.elements.map((existing) =>
						existing.id === updated.id ? updated : existing,
					),
				},
				label,
			);
		return [
			{
				id: "width",
				label: labels.width,
				value: String(selectedElement.widthM),
				numericRange: PRIMITIVE_SIZE_RANGE_M,
				unit: "m",
				onCommit: (value) =>
					updateElement(
						{ ...selectedElement, widthM: Number(value) },
						labels.width,
					),
			},
			{
				id: "height",
				label: labels.height,
				value: String(selectedElement.heightM),
				numericRange: PRIMITIVE_SIZE_RANGE_M,
				unit: "m",
				onCommit: (value) =>
					updateElement(
						{ ...selectedElement, heightM: Number(value) },
						labels.height,
					),
			},
			{
				id: "depth",
				label: labels.depth,
				value: String(selectedElement.depthM),
				numericRange: PRIMITIVE_SIZE_RANGE_M,
				unit: "m",
				onCommit: (value) =>
					updateElement(
						{ ...selectedElement, depthM: Number(value) },
						labels.depth,
					),
			},
			{
				id: "material",
				label: labels.material,
				value: selectedElement.material,
				options: materialOptions,
				onCommit: (value) => {
					const material = STRUCTURE_MATERIALS.find(
						(option) => option === value,
					);
					if (material)
						updateElement({ ...selectedElement, material }, labels.material);
				},
			},
		];
	}
	const fields: StructureEditorField[] = [
		{
			id: "name",
			label: labels.name,
			value: selectedStructure.name,
			required: true,
			maxLength: fleetNameSchema.maxLength ?? undefined,
			onCommit: (value) => {
				if (fleetNameSchema.safeParse(value).success)
					onChange({ ...selectedStructure, name: value }, labels.name);
			},
		},
		{
			id: "status",
			label: labels.status,
			value: selectedStructure.status,
			options: STRUCTURE_STATUSES.map((value) => ({
				value,
				label: labels[value],
			})),
			onCommit: (value) => {
				const status = STRUCTURE_STATUSES.find((option) => option === value);
				if (status) onChange({ ...selectedStructure, status }, labels.status);
			},
		},
	];
	const template = selectedStructure.template;
	if (template.kind === "bridge")
		fields.push(
			{
				id: "deckWidth",
				label: labels.deckWidth,
				value: String(template.deckWidthM),
				numericRange: BRIDGE_PARAMETERS.deckWidthM,
				unit: "m",
				onCommit: (value) =>
					onChange(
						{
							...selectedStructure,
							template: { ...template, deckWidthM: Number(value) },
						},
						labels.deckWidth,
					),
			},
			{
				id: "pierCount",
				label: labels.pierCount,
				value: String(template.pierCount),
				numericRange: BRIDGE_PARAMETERS.pierCount,
				onCommit: (value) =>
					onChange(
						{
							...selectedStructure,
							template: { ...template, pierCount: Math.round(Number(value)) },
						},
						labels.pierCount,
					),
			},
			{
				id: "material",
				label: labels.material,
				value: template.deckMaterial,
				options: materialOptions,
				onCommit: (value) => {
					const deckMaterial = STRUCTURE_MATERIALS.find(
						(option) => option === value,
					);
					if (deckMaterial)
						onChange(
							{ ...selectedStructure, template: { ...template, deckMaterial } },
							labels.material,
						);
				},
			},
		);
	if (template.kind === "tunnel")
		fields.push(
			{
				id: "sectionWidth",
				label: labels.sectionWidth,
				value: String(template.sectionWidthM),
				numericRange: TUNNEL_PARAMETERS.sectionWidthM,
				unit: "m",
				onCommit: (value) =>
					onChange(
						{
							...selectedStructure,
							template: { ...template, sectionWidthM: Number(value) },
						},
						labels.sectionWidth,
					),
			},
			{
				id: "sectionHeight",
				label: labels.sectionHeight,
				value: String(template.sectionHeightM),
				numericRange: TUNNEL_PARAMETERS.sectionHeightM,
				unit: "m",
				onCommit: (value) =>
					onChange(
						{
							...selectedStructure,
							template: { ...template, sectionHeightM: Number(value) },
						},
						labels.sectionHeight,
					),
			},
			{
				id: "sectionShape",
				label: labels.sectionShape,
				value: template.shape,
				options: TUNNEL_SECTION_SHAPES.map((value) => ({
					value,
					label: labels[value],
				})),
				onCommit: (value) => {
					const shape = TUNNEL_SECTION_SHAPES.find(
						(option) => option === value,
					);
					if (shape)
						onChange(
							{ ...selectedStructure, template: { ...template, shape } },
							labels.sectionShape,
						);
				},
			},
		);
	if (template.kind === "bypass")
		fields.push(
			{
				id: "lanes",
				label: labels.lanes,
				value: String(template.laneCount),
				numericRange: BYPASS_PARAMETERS.laneCount,
				onCommit: (value) =>
					onChange(
						{
							...selectedStructure,
							template: { ...template, laneCount: Math.round(Number(value)) },
						},
						labels.lanes,
					),
			},
			{
				id: "laneWidth",
				label: labels.laneWidth,
				value: String(template.laneWidthM),
				numericRange: BYPASS_PARAMETERS.laneWidthM,
				unit: "m",
				onCommit: (value) =>
					onChange(
						{
							...selectedStructure,
							template: { ...template, laneWidthM: Number(value) },
						},
						labels.laneWidth,
					),
			},
		);
	if (template.kind !== "entity") {
		const lengthM = structureLengthM(template);
		fields.push({
			id: "length",
			label: template.kind === "bridge" ? labels.span : labels.length,
			value: formatStructureLength(lengthM, locale),
			readOnly: true,
		});
	}
	fields.push(
		{
			id: "location",
			label: labels.location,
			value: `${selectedStructure.anchor.lat.toFixed(ENGINEERING_COORDINATE_DIGITS)}, ${selectedStructure.anchor.lng.toFixed(ENGINEERING_COORDINATE_DIGITS)} · ${m.engineering_elevation({ n: elevationFormatter.format(selectedStructure.anchor.elevationM) })}`,
			readOnly: true,
		},
		{
			id: "notes",
			label: labels.notes,
			value: selectedStructure.notes,
			multiline: true,
			maxLength: MAX_STRUCTURE_NOTES_LENGTH_CHARS,
			placeholder: labels.notesPlaceholder,
			onCommit: (value) =>
				onChange({ ...selectedStructure, notes: value }, labels.notes),
		},
	);
	return fields;
}
