export const INCIDENT_CATEGORY_LABELS = {
	road_accident: "Accidente vial",
	road_works: "Obras en la vía",
	road_block: "Bloqueo de vía",
	landslide: "Deslizamiento",
	flood: "Inundación",
	fire: "Incendio",
	wildfire: "Incendio forestal",
	earthquake: "Sismo",
	weather: "Tiempo adverso",
	medical: "Emergencia médica",
	rescue: "Rescate",
	hazmat: "Materiales peligrosos",
	rain_warning: "Aviso de lluvia",
	flood_warning: "Aviso de inundación",
	other: "Otros",
};

export const INCIDENT_SEVERITY_LABELS = {
	critical: "Crítica",
	warning: "Precaución",
	info: "Informativa",
};

export const INCIDENT_MARKER_TONE_CLASSES = {
	low: {
		filled: "bg-risk-low text-risk-low-foreground",
		outline:
			"border-risk-low bg-[color-mix(in_oklab,var(--risk-low)_8%,var(--card))]",
	},
	moderate: {
		filled: "bg-risk-moderate text-risk-moderate-foreground",
		outline:
			"border-risk-moderate bg-[color-mix(in_oklab,var(--risk-moderate)_8%,var(--card))]",
	},
	high: {
		filled: "bg-risk-high text-risk-high-foreground",
		outline:
			"border-risk-high bg-[color-mix(in_oklab,var(--risk-high)_8%,var(--card))]",
	},
	critical: {
		filled: "bg-risk-critical text-risk-critical-foreground",
		outline:
			"border-risk-critical bg-[color-mix(in_oklab,var(--risk-critical)_8%,var(--card))]",
	},
	info: {
		filled: "bg-info text-info-foreground",
		outline: "border-info bg-[color-mix(in_oklab,var(--info)_8%,var(--card))]",
	},
	neutral: {
		filled: "bg-muted-foreground text-background",
		outline: "border-muted-foreground bg-card",
	},
};

export const INCIDENT_SEVERITY_TONES = {
	critical: "critical",
	warning: "high",
	info: "info",
} satisfies Record<
	keyof typeof INCIDENT_SEVERITY_LABELS,
	keyof typeof INCIDENT_MARKER_TONE_CLASSES
>;

export const INCIDENT_SEVERITY_TEXT_CLASSES = {
	critical: "text-risk-critical",
	warning: "text-risk-high",
	info: "text-info",
};

export const INCIDENT_SEVERITY_TOKENS = {
	critical: "--risk-critical",
	warning: "--risk-high",
	info: "--info",
};

export const ROAD_STATUS_LABELS = {
	interrumpido: "Vía interrumpida",
	restringido: "Tránsito restringido",
	normal: "Tránsito normal",
};

export const INCIDENT_SOURCE_LABELS: Record<string, string> = {
	sutran_alerts: "SUTRAN · Alertas en carreteras",
	indeci_coen_emergencies: "INDECI · Emergencias (COEN)",
	bomberos_emergencies_24h: "Bomberos del Perú · Últimas 24 h",
	senamhi_warnings: "SENAMHI · Avisos meteorológicos e hidrológicos",
	igp_last_earthquake: "IGP · Último sismo",
	serfor_wildfire_alerts: "SERFOR · Alertas de incendios forestales",
	rpp_latest_news: "RPP Noticias",
	sratma_accidents: "MTC · Accidentes de tránsito (SRATMA)",
};

export const INCIDENT_SEVERITY_OPTIONS: (keyof typeof INCIDENT_SEVERITY_LABELS)[] =
	["critical", "warning", "info"];

export const INCIDENT_CATEGORY_OPTIONS = Object.entries(
	INCIDENT_CATEGORY_LABELS,
).map(([value, label]) => ({ value, label }));
