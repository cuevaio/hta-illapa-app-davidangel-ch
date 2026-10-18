/** Entry of the viewer for host apps; its types are declared in api.public.d.ts. */

export { DEFAULT_ATTRIBUTION as TERRAIN_ATTRIBUTION } from "../map/tilesClient";
export {
	type VrButtonFace,
	vrButtonFace,
	vrTextCard,
} from "../ui/vr/faces";
export {
	BUTTON_HEIGHT_CSS_PX as VR_BUTTON_HEIGHT_CSS_PX,
	CONTROL_GAP_CSS_PX as VR_CONTROL_GAP_CSS_PX,
	metresOf as vrMetresOf,
	texturePx as vrTexturePx,
} from "../ui/vr/theme";
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
