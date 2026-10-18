import {
	MS_PER_SECOND,
	ROUTE_REVIEW_DEPARTURE_CLOCK_SKEW_MS,
	ROUTE_REVIEW_DEPARTURE_WINDOW_MS,
} from "../constants";

interface TimedTrip {
	status: "planned" | "active" | "completed" | "cancelled";
	departureAt: Date;
	chosenCandidate: { durationS: number };
}

export function isUpcomingTrip(trip: TimedTrip, now: Date) {
	const estimatedArrivalMs =
		trip.departureAt.getTime() + trip.chosenCandidate.durationS * MS_PER_SECOND;
	return (
		trip.status === "active" ||
		(trip.status === "planned" && estimatedArrivalMs >= now.getTime())
	);
}

export function isDepartureInReviewWindow(departureAt: Date, now: Date) {
	const departureMs = departureAt.getTime();
	return (
		departureMs >= now.getTime() - ROUTE_REVIEW_DEPARTURE_CLOCK_SKEW_MS &&
		departureMs <=
			now.getTime() +
				ROUTE_REVIEW_DEPARTURE_WINDOW_MS +
				ROUTE_REVIEW_DEPARTURE_CLOCK_SKEW_MS
	);
}
