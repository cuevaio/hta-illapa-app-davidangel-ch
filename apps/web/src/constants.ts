import {
	MIN_PASSWORD_LENGTH_CHARS,
	MS_PER_HOUR,
	MS_PER_MINUTE,
} from "@hack-the-andes-project/business/constants";
import type {
	Incident,
	IncidentTimePreset,
} from "@hack-the-andes-project/ui/lib/incident";
import { m } from "@/paraglide/messages";

export const SHOWCASE_SECTIONS = [
	{ id: "color", label: m.ds_nav_color },
	{ id: "tipografia", label: m.ds_nav_type },
	{ id: "espacio", label: m.ds_nav_spacing },
	{ id: "componentes", label: m.ds_nav_components },
	{ id: "riesgo", label: m.ds_risk_label },
	{ id: "datos", label: m.ds_nav_data },
	{ id: "criterios", label: m.ds_nav_guidelines },
	{ id: "panel", label: m.ds_panel_title },
];

export const SHOWCASE_APP_ICON_SIZES_PX = [64, 32, 16];

interface RiskLevel {
	variant: "low" | "moderate" | "high" | "critical";
	label: () => string;
	colorName: () => string;
	fillClassName: string;
	inkClassName: string;
	recommendation: () => string;
}

export const RISK_LEVELS: RiskLevel[] = [
	{
		variant: "low",
		label: m.risk_low,
		colorName: m.risk_color_low,
		fillClassName: "bg-risk-low",
		inkClassName: "text-risk-low-foreground",
		recommendation: m.recommendation_continue,
	},
	{
		variant: "moderate",
		label: m.risk_moderate,
		colorName: m.risk_color_moderate,
		fillClassName: "bg-risk-moderate",
		inkClassName: "text-risk-moderate-foreground",
		recommendation: m.recommendation_monitor,
	},
	{
		variant: "high",
		label: m.risk_high,
		colorName: m.risk_color_high,
		fillClassName: "bg-risk-high",
		inkClassName: "text-risk-high-foreground",
		recommendation: m.recommendation_delay,
	},
	{
		variant: "critical",
		label: m.risk_critical,
		colorName: m.risk_color_critical,
		fillClassName: "bg-risk-critical",
		inkClassName: "text-risk-critical-foreground",
		recommendation: m.recommendation_reroute,
	},
];

interface RouteExample {
	id: string;
	name: () => string;
	risk: RiskLevel["variant"];
	riskLabel: () => string;
	horizon: () => string;
	cause: () => string;
	recommendation: () => string;
}

export const ROUTE_EXAMPLES: RouteExample[] = [
	{
		id: "PE-22",
		name: m.ds_route_central_name,
		risk: "critical",
		riskLabel: m.risk_critical,
		horizon: m.horizon_now,
		cause: m.ds_route_central_cause,
		recommendation: m.recommendation_reroute,
	},
	{
		id: "PE-1N",
		name: m.ds_route_north_name,
		risk: "high",
		riskLabel: m.risk_high,
		horizon: () => m.horizon_hours({ hours: "6" }),
		cause: m.ds_route_north_cause,
		recommendation: m.recommendation_delay,
	},
	{
		id: "PE-30C",
		name: m.ds_route_interoceanic_name,
		risk: "moderate",
		riskLabel: m.risk_moderate,
		horizon: () => m.horizon_hours({ hours: "24" }),
		cause: m.ds_route_interoceanic_cause,
		recommendation: m.recommendation_monitor,
	},
	{
		id: "PE-1S",
		name: m.ds_route_south_name,
		risk: "low",
		riskLabel: m.risk_low,
		horizon: m.horizon_now,
		cause: m.ds_route_south_cause,
		recommendation: m.recommendation_continue,
	},
	{
		id: "PE-3S",
		name: m.ds_route_sierra_name,
		risk: "high",
		riskLabel: m.risk_high,
		horizon: () => m.horizon_hours({ hours: "48" }),
		cause: m.ds_route_sierra_cause,
		recommendation: m.recommendation_monitor,
	},
];

export const SPACING_SCALE = [
	{ token: "1", size: "4 px", className: "w-1" },
	{ token: "2", size: "8 px", className: "w-2" },
	{ token: "3", size: "12 px", className: "w-3" },
	{ token: "4", size: "16 px", className: "w-4" },
	{ token: "6", size: "24 px", className: "w-6" },
	{ token: "8", size: "32 px", className: "w-8" },
	{ token: "12", size: "48 px", className: "w-12" },
	{ token: "16", size: "64 px", className: "w-16" },
];

export const MINIMUM_NAME_LENGTH = 2;
export const MINIMUM_PASSWORD_LENGTH = 8;

export function getShowcaseStateLabels() {
	return {
		default: m.ds_state_default(),
		hover: m.ds_state_hover(),
		focus: m.ds_state_focus(),
		active: m.ds_state_active(),
		disabled: m.ds_state_disabled(),
		invalid: m.ds_state_invalid(),
	};
}

export const SHOWCASE_DATE_ISO = "2026-10-17T12:00:00";
export const SHOWCASE_HORIZON_HOURS = 6;
export const SHOWCASE_MAX_HORIZON_HOURS = 48;
export const SHOWCASE_OTP_LENGTH = 6;
export const SHOWCASE_OTP_INDICES = [0, 1, 2, 3, 4, 5];
export const SHOWCASE_PREVIEW_ASPECT_RATIO = 16 / 9;
export const SHOWCASE_JSON_INDENT = 2;
export const SHOWCASE_PROGRESS_PERCENT = 75;
export const SHOWCASE_TOASTER_ID = "design-system";
export const SHOWCASE_QUESTIONNAIRE_ITEMS = [
	{ name: "route", choices: [{ value: "PE-22" }, { value: "PE-1N" }] },
	{ name: "cargo", choices: [{ value: "general" }, { value: "perishable" }] },
];

export const INCIDENT_REFETCH_INTERVAL_MS = 60_000;
export const DEFAULT_INCIDENT_LIMIT_ROWS = 2_000;
export const DEFAULT_NEWS_LIMIT_ROWS = 50;
export const NEWS_REFETCH_INTERVAL_MS = 60_000;
export const NEWS_SKELETON_KEYS = ["lead", "second", "third", "fourth"];
export const LAST_DAY_DURATION_MS = 86_400_000;
export const LAST_WEEK_DURATION_MS = 604_800_000;
export const DEFAULT_SINCE_PRESET = "all";

interface SincePreset extends IncidentTimePreset {
	durationMs: number | null;
}

export const INCIDENT_SINCE_PRESETS: SincePreset[] = [
	{ value: "24h", label: "Últimas 24 h", durationMs: LAST_DAY_DURATION_MS },
	{ value: "7d", label: "Últimos 7 días", durationMs: LAST_WEEK_DURATION_MS },
	{ value: DEFAULT_SINCE_PRESET, label: "Todo el período", durationMs: null },
];

export const EMPTY_INCIDENTS: Incident[] = [];

export const ALERT_REFETCH_INTERVAL_MS = 30_000;
export const FLEET_REFETCH_INTERVAL_MS = 120_000;
export const STALE_TRIP_EVALUATION_MS = MS_PER_HOUR;
export const SEEN_ALERTS_STORAGE_PREFIX = "illapa-seen-alerts-v1";

export const TOO_MANY_REQUESTS_STATUS = 429;
export const CONFLICT_STATUS = 409;
export const DEMO_START_ROUTE = "/dashboard/revisar-ruta";
export const DEFAULT_AUTH_ERROR_MESSAGE =
	"No pudimos completar la solicitud. Inténtalo de nuevo.";
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
	INVALID_EMAIL_OR_PASSWORD: "Correo o contraseña incorrectos.",
	INVALID_EMAIL: "Ingresa un correo válido.",
	USER_ALREADY_EXISTS: "Ya existe una cuenta con este correo.",
	USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
		"Ya existe una cuenta con este correo.",
	PASSWORD_TOO_SHORT: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH_CHARS} caracteres.`,
	PASSWORD_TOO_LONG: "La contraseña es demasiado larga.",
};
export const RATE_LIMITED_AUTH_MESSAGE =
	"Demasiados intentos. Espera un momento e inténtalo de nuevo.";

export const SHOWCASE_RADIUS_SCALE = [
	{ token: "rounded-xs", size: "4 px", role: m.ds_radius_detail },
	{ token: "rounded-sm", size: "6 px", role: m.ds_radius_inner },
	{ token: "rounded-md", size: "10 px", role: m.ds_radius_controls },
	{ token: "rounded-lg", size: "14 px", role: m.ds_radius_surfaces },
	{ token: "rounded-xl", size: "18 px", role: m.ds_radius_large },
	{ token: "rounded-2xl", size: "22 px", role: m.ds_radius_feature },
	{ token: "rounded-3xl", size: "26 px", role: m.ds_radius_hero },
	{ token: "rounded-full", size: "full", role: m.ds_radius_round },
];

export const USER_INITIALS_CHARACTER_COUNT = 2;

export const ROUTE_REVIEW_TIME_ZONE = "America/Lima";
export const ROUTE_REVIEW_TIME_OFFSET = "-05:00";
export const ROUTE_REVIEW_LAST_VEHICLE_KEY = "route-review:last-vehicle:v1";
export const ROUTE_REVIEW_MAP_LINE_WIDTH_PX = 3;
export const ROUTE_REVIEW_MAP_SELECTED_WIDTH_PX = 6;
export const ROUTE_REVIEW_MAP_CASING_WIDTH_PX = 8;

export const ROUTE_REVIEW_DEPARTURE_STEP_MS = 15 * MS_PER_MINUTE;
export const ROUTE_REVIEW_DEPARTURE_LEAD_MS = 15 * MS_PER_MINUTE;
export const ROUTE_REVIEW_MAP_FIT_PADDING_PX = 32;
export const ROUTE_REVIEW_MAP_LEGEND_PADDING_PX = 144;
export const ROUTE_REVIEW_MAP_COMPACT_LEGEND_PADDING_PX = 72;
export const ROUTE_REVIEW_MAP_COMPACT_HEIGHT_PX = 240;

export const ROUTE_REVIEW_QUERY_KEY: readonly string[] = ["route-review"];
