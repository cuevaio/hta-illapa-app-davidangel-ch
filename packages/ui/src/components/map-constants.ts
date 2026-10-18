export const PERU_WEST_LONGITUDE_DEG = -81.4;
export const PERU_SOUTH_LATITUDE_DEG = -18.4;
export const PERU_EAST_LONGITUDE_DEG = -68.6;
export const PERU_NORTH_LATITUDE_DEG = -0.03;
export const PERU_FIT_PADDING_PX = 40;
export const INCIDENT_FILL_OPACITY_RATIO = 0.08;
export const INCIDENT_LINE_WIDTH_PX = 3;
export const INCIDENT_POINT_RADIUS_PX = 6;
export const INCIDENT_POINT_STROKE_WIDTH_PX = 2;
export const INCIDENT_GEOMETRY_SOURCE_ID = "incidents";
export const INCIDENT_FILL_LAYER_ID = "incident-areas";
export const INCIDENT_LINE_LAYER_ID = "incident-lines";
export const INCIDENT_POINT_LAYER_ID = "incident-points";
export const INCIDENT_INTERACTIVE_LAYER_IDS = [
	INCIDENT_FILL_LAYER_ID,
	INCIDENT_LINE_LAYER_ID,
	INCIDENT_POINT_LAYER_ID,
];
export const CARTO_DARK_STYLE_URL =
	"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
export const CARTO_LIGHT_STYLE_URL =
	"https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export const PERU_INITIAL_VIEW_STATE = {
	bounds: [
		[PERU_WEST_LONGITUDE_DEG, PERU_SOUTH_LATITUDE_DEG],
		[PERU_EAST_LONGITUDE_DEG, PERU_NORTH_LATITUDE_DEG],
	] satisfies [[number, number], [number, number]],
	fitBoundsOptions: { padding: PERU_FIT_PADDING_PX },
};

export const FLEET_ROUTE_WIDTH_PX = 4;
export const FLEET_ALTERNATIVE_DASH_WIDTH_RATIOS = [2, 2];
export const ROUTE_REVIEW_INELIGIBLE_LINE_OPACITY_RATIO = 0.35;
export const FLEET_ROUTE_SOURCE_PREFIX = "fleet-route-";
export const FLEET_HAZARD_SOURCE_ID = "fleet-hazard";
export const FLEET_HAZARD_FILL_LAYER_ID = "fleet-hazard-area";
export const FLEET_HAZARD_LINE_LAYER_ID = "fleet-hazard-line";
export const FLEET_HAZARD_POINT_LAYER_ID = "fleet-hazard-point";
export const FLEET_MAP_PADDING_PX = 48;
export const FLEET_MAP_MAX_ZOOM_LEVEL = 13;
export const FLEET_MAP_FIT_DURATION_MS = 0;

export const MAP_SPANISH_LOCALE = {
	"Map.Title": "Mapa",
	"Marker.Title": "Marcador del mapa",
	"NavigationControl.ZoomIn": "Acercar",
	"NavigationControl.ZoomOut": "Alejar",
	"NavigationControl.ResetBearing":
		"Arrastra para girar el mapa o pulsa para orientar al norte",
	"AttributionControl.ToggleAttribution": "Mostrar créditos del mapa",
	"Popup.Close": "Cerrar detalle",
};
export const INCIDENT_PREVIEW_OPEN_DELAY_MS = 150;
export const INCIDENT_PREVIEW_CLOSE_DELAY_MS = 100;
export const INCIDENT_PREVIEW_OFFSET_PX = 8;
