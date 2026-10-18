/**
 * Convective potential from the GFS surface-based CAPE forecast (J/kg), after peru-simulator's
 * src/domain/cape.ts: discrete categories drawn hatched in violet/magenta (terrain shader) so
 * they are never mistaken for rain or observed lightning. Pure.
 */
export interface CapeCategory {
	min: number;
	label: string;
	color: readonly [number, number, number];
}

export const CAPE_CATEGORIES: readonly CapeCategory[] = [
	{ min: 250, label: "marginal", color: [190, 160, 255] },
	{ min: 1000, label: "moderado", color: [160, 80, 245] },
	{ min: 2500, label: "alto", color: [235, 50, 215] },
];

export const CAPE_NOTE =
	"Potencial, no tormentas observadas: inestabilidad del modelo (CAPE de superficie). Transparente por debajo de 250 J/kg.";

/** 0 below 250 J/kg (or no data), else 1 marginal, 2 moderate, 3 high. */
export function capeLevel(value: number): number {
	let level = 0;
	CAPE_CATEGORIES.forEach((c, i) => {
		if (value >= c.min) level = i + 1;
	});
	return level;
}

/** "1470 J/kg · potencial moderado (pronóstico)". */
export function formatCape(value: number | null): string {
	if (value === null || !Number.isFinite(value)) return "sin datos aquí";
	const level = capeLevel(value);
	const v = Math.round(value).toLocaleString("es");
	return `${v} J/kg · ${level ? `potencial ${CAPE_CATEGORIES[level - 1].label}` : "sin potencial significativo"} (pronóstico)`;
}
