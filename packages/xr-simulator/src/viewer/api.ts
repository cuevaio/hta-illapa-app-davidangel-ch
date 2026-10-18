/** Entry of the viewer for host apps; its types are declared in api.public.d.ts. */

export { DEFAULT_ATTRIBUTION as TERRAIN_ATTRIBUTION } from "../map/tilesClient";
export type { XrSessionMember } from "../xr/sharedSession";
export {
	type CreateXrViewerOptions,
	createXrViewer,
	type XrViewerHandle,
} from "./createXrViewer";
export type { ViewerScreen } from "./ModeSwitcher";
export type {
	ModeHost,
	ModeVr,
	ModeXr,
	SimulatorMode,
	SimulatorModeFactory,
} from "./SimulatorMode";
export type {
	GeoPoint,
	LocalPoint,
	SiteClip,
	SiteTerrain,
	SiteTerrainOptions,
} from "./SiteTerrain";
