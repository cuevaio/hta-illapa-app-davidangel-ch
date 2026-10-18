/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Base URL of our tiles API (default `/tiles-api`, the Vite proxy). */
	readonly VITE_TILES_URL?: string;
	/** Satellite imagery provider: `esri` | `esri-prototipo` | `maptiler` | `google` | `none` (S7, see .env.example). */
	readonly VITE_IMAGERY_PROVIDER?: string;
	/** Provider key (ArcGIS Location Platform API key for `esri`); only in .env.local, never committed. */
	readonly VITE_IMAGERY_KEY?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
