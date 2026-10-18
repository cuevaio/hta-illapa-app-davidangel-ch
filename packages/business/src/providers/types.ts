import type { ZodType } from "zod";

import type { LatLng } from "../hazards/types";
import type { VehicleTypeId } from "../route-review/vehicle-types";

export const GPS_PROVIDERS = ["geotab", "samsara", "demo"] as const;

export type GpsProviderKind = (typeof GPS_PROVIDERS)[number];

export interface ProviderVehicle {
	vehicleTypeId?: VehicleTypeId;
	axleCount?: number | null;
	grossWeightKg?: number | null;
	externalId: string;
	name: string;
	plate: string | null;
}

export interface DemoVehicle extends ProviderVehicle {
	vehicleTypeId: VehicleTypeId;
	depot: LatLng;
}

export interface ProviderPosition {
	externalId: string;
	lat: number;
	lng: number;
	speedKmh: number | null;
	heading: number | null;
	recordedAt: Date;
}

export interface GpsProvider<Credentials> {
	kind: GpsProviderKind;
	credentialsSchema: ZodType<Credentials>;
	validateCredentials(
		credentials: Credentials,
		fetchImpl?: typeof fetch,
	): Promise<void>;
	listVehicles(
		credentials: Credentials,
		fetchImpl?: typeof fetch,
	): Promise<ProviderVehicle[]>;
	fetchLatestPositions(
		credentials: Credentials,
		fetchImpl?: typeof fetch,
	): Promise<ProviderPosition[]>;
}
