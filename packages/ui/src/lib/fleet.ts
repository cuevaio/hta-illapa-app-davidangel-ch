import type { GpsCredentialsInput } from "@hack-the-andes-project/business/providers/index";
import type { VehicleTypeId } from "@hack-the-andes-project/business/route-review/vehicle-types";
import type { Geometry, LineString } from "geojson";
import type { SeverityProps } from "../components/severity";
import type {
	RouteEnumLabels,
	RouteRecommendationLabels,
	RouteReviewTripSummary,
} from "./route-review";

export interface FleetConnection {
	id: string;
	provider: GpsCredentialsInput["provider"];
	label: string;
	status: "active" | "error";
	lastSyncAt: Date | null;
	lastError: string | null;
	vehicleCount: number;
}

export interface FleetVehicle {
	id: string;
	name: string;
	plate: string | null;
	lastLat: number | null;
	lastLng: number | null;
	lastHeading: number | null;
	lastSpeedKmh: number | null;
	lastPositionAt: Date | null;
	provider: FleetConnection["provider"] | null;
	activeTrip: {
		id: string;
		name: string;
		destinationName: string;
		etaAt: Date | null;
	} | null;
}

export interface FleetTrip {
	id: string;
	vehicleId: string;
	vehicleName: string | null;
	name: string;
	destinationName: string;
	routeGeometry: LineString;
	routeDistanceM: number;
	routeDurationS: number;
	status: "planned" | "active" | "completed" | "cancelled";
	etaAt: Date | null;
	openAlertCount: number;
}

export interface FleetConnectionInput {
	label: string;
	credentials: GpsCredentialsInput;
}

export interface FleetAlert {
	id: string;
	tripId: string;
	vehicleName: string | null;
	tripName: string | null;
	severity: SeverityProps["severity"];
	title: string;
	message: string;
	distanceAheadM: number;
	etaToHazardAt: Date | null;
	status: "open" | "acknowledged" | "resolved";
	alternativeRoute: {
		geometry: LineString;
		distanceM: number;
		durationS: number;
	} | null;
	incident: {
		geometry: Geometry | null;
		lat: number | null;
		lng: number | null;
	} | null;
}

export interface FleetRouteVehicle {
	id: string;
	name: string;
	plate: string | null;
	provider: FleetConnection["provider"] | null;
	profile: {
		vehicleTypeId: VehicleTypeId;
		axleCount: number;
		grossWeightKg: number | null;
	} | null;
}

export interface VehicleProfileDraft {
	name: string;
	plate: string | null;
	vehicleTypeId: VehicleTypeId;
	axleCount: number;
	grossWeightKg: number | null;
}

export interface VehicleProfileDialogLabels {
	createTitle: string;
	setTypeTitle: string;
	createDescription: string;
	setTypeDescription: string;
	name: string;
	plate: string;
	optionalPlate: string;
	origin: string;
	providerDescription: (provider: string) => string;
	manual: string;
	vehicleType: string;
	axles: string;
	weight: string;
	optionalWeight: string;
	otherHint: string;
	axleHint: string;
	typeHint: (type: string) => string;
	typeDetails: (axles: number, tonnes: number) => string;
	nameRequired: string;
	typeRequired: string;
	axlesInvalid: string;
	weightInvalid: string;
	errorTitle: string;
	errorDescription: string;
	cancel: string;
	create: string;
	saveType: string;
	saving: string;
}

export interface FleetPlannedTrip extends RouteReviewTripSummary {}

export interface FleetPlannedTripsLabels
	extends RouteEnumLabels,
		RouteRecommendationLabels {
	filter: string;
	allVehicles: (count: number) => string;
	upcomingCount: (count: number) => string;
	connections: string;
	upcoming: string;
	noUpcoming: string;
	history: (count: number) => string;
	route: string;
	departure: string;
	chosenPath: string;
	riskAction: string;
	evaluated: string;
	stale: string;
	noType: string;
	setType: string;
	missingTypeTitle: (name: string) => string;
	missingTypesTitle: (count: number) => string;
	missingTypeDescription: (count: number) => string;
	planTrip: string;
	planWithVehicle: string;
	planNamedVehicle: (name: string) => string;
	noTripsTitle: string;
	noTripsDescription: string;
	filterEmpty: (name: string) => string;
	filterMissingType: (name: string) => string;
	viewAll: string;
	deletedVehicle: string;
	departed: string;
	manual: string;
	axleCount: (count: number) => string;
	gpsProvider: (provider: string) => string;
	weightTonnes: (tonnes: number) => string;
	unknownRisk: string;
	vehicleTypes: Record<VehicleTypeId, string>;
}
