import { STRUCTURE_DECIMAL_SEPARATOR_SAMPLE_RATIO } from "./constants";

export function parseStructureNumber(value: string, locale: string): number {
	const decimalSeparator =
		new Intl.NumberFormat(locale)
			.formatToParts(STRUCTURE_DECIMAL_SEPARATOR_SAMPLE_RATIO)
			.find((part) => part.type === "decimal")?.value ?? ".";
	return Number(value.replace(decimalSeparator, ".").replace(",", "."));
}
