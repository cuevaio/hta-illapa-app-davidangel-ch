import type { StructureKind } from "./catalog";

interface NamedStructure {
	name: string;
	template: { kind: StructureKind };
}

export function nextStructureName(
	structures: NamedStructure[],
	kind: StructureKind,
	label: string,
) {
	const names = new Set(
		structures
			.filter((structure) => structure.template.kind === kind)
			.map((structure) => structure.name),
	);
	let nextNumber = 1;
	while (names.has(`${label} ${nextNumber}`)) nextNumber += 1;
	return `${label} ${nextNumber}`;
}

interface NamedElement {
	id: string;
	kind: string;
}

export function structureElementName(
	elements: NamedElement[],
	elementId: string,
	label: string,
) {
	const elementIndex = elements.findIndex(
		(candidate) => candidate.id === elementId,
	);
	const selectedElement = elements[elementIndex];
	const ordinal =
		elements
			.slice(0, elementIndex)
			.filter((candidate) => candidate.kind === selectedElement?.kind).length +
		1;
	return `${label} ${ordinal}`;
}
