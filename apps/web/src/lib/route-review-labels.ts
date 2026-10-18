import {
	METERS_PER_KM,
	MINUTES_PER_HOUR,
	MS_PER_HOUR,
	MS_PER_MINUTE,
	ROUTE_REVIEW_DEPARTURE_WINDOW_MS,
	SECONDS_PER_MINUTE,
} from "@hack-the-andes-project/business/constants";
import type {
	RouteEnumLabels,
	RouteReviewLabels,
} from "@hack-the-andes-project/ui/lib/route-review";
import { ROUTE_REVIEW_TIME_ZONE } from "@/constants";
import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";

function routeReviewDateParts(date: Date) {
	const parts = new Intl.DateTimeFormat(getLocale() === "es" ? "es-PE" : "en", {
		timeZone: ROUTE_REVIEW_TIME_ZONE,
		day: "numeric",
		month: "short",
		year: "numeric",
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	return Object.fromEntries(
		parts.map((part) => [
			part.type,
			part.type === "month" || part.type === "weekday"
				? part.value.replace(/\.$/, "")
				: part.value,
		]),
	);
}
export function formatRouteReviewDateTime(date: Date): string {
	const parts = routeReviewDateParts(date);
	return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`;
}
export function formatRouteReviewWeekdayDateTime(date: Date): string {
	const parts = routeReviewDateParts(date);
	return `${parts.weekday} ${parts.day} ${parts.month} · ${parts.hour}:${parts.minute}`;
}
export function formatRouteReviewRelativeTime(date: Date) {
	const elapsedMs = Date.now() - date.getTime();
	if (elapsedMs < MS_PER_MINUTE && elapsedMs >= 0)
		return m.route_review_seconds_ago();
	if (Math.abs(elapsedMs) >= ROUTE_REVIEW_DEPARTURE_WINDOW_MS) {
		const parts = routeReviewDateParts(date);
		return `${parts.day} ${parts.month} ${parts.year}`;
	}
	const formatter = new Intl.RelativeTimeFormat(
		getLocale() === "es" ? "es-PE" : "en",
		{ numeric: "always" },
	);
	return Math.abs(elapsedMs) < MS_PER_HOUR
		? formatter.format(-Math.floor(elapsedMs / MS_PER_MINUTE), "minute")
		: formatter.format(-Math.floor(elapsedMs / MS_PER_HOUR), "hour");
}
export function formatRouteReviewDistance(meters: number) {
	return new Intl.NumberFormat(getLocale() === "es" ? "es-PE" : "en", {
		style: "unit",
		unit: "kilometer",
		maximumFractionDigits: 0,
	}).format(meters / METERS_PER_KM);
}
export function formatRouteReviewDuration(seconds: number) {
	const totalMinutes = Math.round(seconds / SECONDS_PER_MINUTE);
	const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
	const minutes = totalMinutes % MINUTES_PER_HOUR;
	return hours
		? minutes
			? m.route_review_duration({ hours, minutes })
			: m.route_review_hours({ hours })
		: m.route_review_minutes({ minutes });
}
export function formatRouteReviewLocalInput(date: Date) {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: ROUTE_REVIEW_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const fields = Object.fromEntries(
		parts.map((part) => [part.type, part.value]),
	);
	return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}
export function getRouteEnumLabels(): RouteEnumLabels {
	return {
		riskLevels: {
			low: m.risk_low(),
			moderate: m.risk_moderate(),
			high: m.risk_high(),
			critical: m.risk_critical(),
		},
		recommendations: {
			continue: m.recommendation_continue(),
			monitor: m.recommendation_monitor(),
			delay: m.recommendation_delay(),
			reroute: m.recommendation_reroute(),
		},
		horizons: {
			now: m.horizon_now(),
			"24h": m.horizon_hours({ hours: "24" }),
			"48h": m.horizon_hours({ hours: "48" }),
			"72h": m.horizon_hours({ hours: "72" }),
		},
		sources: {
			illapa: m.route_review_source_illapa(),
			sutran: m.route_review_source_sutran(),
		},
		tripStatuses: {
			planned: m.route_review_status_planned(),
			active: m.route_review_status_active(),
			completed: m.route_review_status_completed(),
			cancelled: m.route_review_status_cancelled(),
		},
	};
}
export function getRouteReviewLabels(): RouteReviewLabels {
	const enums = getRouteEnumLabels();
	return {
		recommended: m.route_review_recommended(),
		chosen: m.route_review_chosen(),
		why: m.route_review_why(),
		planTrip: m.plan_trip(),
		useThisRoute: m.route_review_use_route(),
		illapaGroup: m.route_review_illapa_group(),
		sutranGroup: m.route_review_sutran_group(),
		aiExplanation: m.route_review_ai_explanation(),
		noSignals: m.route_review_no_signals(),
		ruleLabel: m.route_review_rule(),
		valid: m.route_review_valid(),
		risk: m.route_review_risk(),
		horizonHelp: (horizon) =>
			m.route_review_horizon_help({ window: enums.horizons[horizon] }),
		viewOnMap: m.route_review_view_map(),
		mapLabel: m.route_review_map_label(),
		legend: m.route_review_legend(),
		expand: m.route_review_expand(),
		close: m.route_review_close(),
		calculating: m.route_review_calculating(),
		origin: m.route_review_origin(),
		destination: m.route_review_destination(),
		swap: m.route_review_swap(),
		vehicle: m.vehicle(),
		departure: m.route_review_departure(),
		review: m.route_review_review(),
		reviewing: m.route_review_reviewing(),
		edit: m.route_review_edit(),
		addVehicle: m.add_vehicle(),
		setVehicleType: m.set_vehicle_type(),
		missingType: m.route_review_missing_type(),
		noType: m.vehicle_no_type(),
		noMatches: m.route_review_no_matches(),
		chooseVehicle: m.route_review_choose_vehicle(),
		rescore: m.route_review_rescore(),
		rescoring: m.route_review_rescoring(),
		cancelTrip: m.route_review_cancel_trip(),
		departurePassed: m.route_review_departure_passed(),
		evaluated: m.evaluated(),
		riskLevel: (level) => enums.riskLevels[level],
		recommendation: (action) => enums.recommendations[action],
		rule: (rule) =>
			({
				confirmed_interruption: m.route_review_rule_confirmed_interruption,
				confirmed_restriction: m.route_review_rule_confirmed_restriction,
				forecast_in_window: m.route_review_rule_forecast_in_window,
				forecast_below_high: m.route_review_rule_forecast_below_high,
				baseline_only: m.route_review_rule_baseline_only,
				nothing_relevant: m.route_review_rule_nothing_relevant,
			})[rule](),
		signalKind: (kind, count) =>
			count === undefined
				? {
						confirmed: m.route_review_signal_confirmed,
						forecast: m.route_review_signal_forecast,
						baseline: m.route_review_signal_baseline,
					}[kind]()
				: {
						confirmed:
							count === 1
								? m.route_review_signal_confirmed_one
								: m.route_review_signal_confirmed_count,
						forecast:
							count === 1
								? m.route_review_signal_forecast_one
								: m.route_review_signal_forecast_count,
						baseline: m.route_review_signal_baseline_count,
					}[kind]({ count }),
		source: (source) => enums.sources[source],
		horizon: (horizon) => enums.horizons[horizon],
		roadStatus: (status) =>
			({
				normal: m.route_review_road_normal,
				restringido: m.route_review_road_restricted,
				interrumpido: m.route_review_road_interrupted,
			})[status](),
		notEligible: (axles) => m.route_review_not_eligible({ axles }),
		axles: (axles) => m.axle_count({ count: axles }),
		distance: formatRouteReviewDistance,
		duration: formatRouteReviewDuration,
		dateTime: formatRouteReviewDateTime,
		observedAt: (date) =>
			Math.abs(Date.now() - date.getTime()) < ROUTE_REVIEW_DEPARTURE_WINDOW_MS
				? `${new Intl.DateTimeFormat(getLocale() === "es" ? "es-PE" : "en", { timeZone: ROUTE_REVIEW_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date)} · ${formatRouteReviewRelativeTime(date)}`
				: formatRouteReviewRelativeTime(date),
		kmRange: (fromM, toM) =>
			m.route_review_km_range({
				from: Math.round(fromM / METERS_PER_KM),
				to: Math.round(toM / METERS_PER_KM),
			}),
		departAt: (date) =>
			m.route_review_depart_at({ date: formatRouteReviewDateTime(date) }),
		delay: (seconds) =>
			m.route_review_delay({ duration: formatRouteReviewDuration(seconds) }),
		rerouteTo: (route) => m.route_review_reroute_to({ route }),
		tripStatus: (status) => enums.tripStatuses[status],
	};
}
