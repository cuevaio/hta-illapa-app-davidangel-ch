export const SERVICE_NAME = "hack-the-andes-scraper";

export const RUN_SECRET_HEADER = "x-scraper-secret";
// Service-binding requests need a syntactically valid URL; the host is ignored.
export const SELF_RUN_ORIGIN = "https://scraper.internal";

export const UPSTREAM_FETCH_TIMEOUT_MS = 20_000;
export const UPSTREAM_USER_AGENT =
	"hack-the-andes-scraper/1.0 (+https://github.com/Franz1241/hack-the-andes-project)";
export const DB_WRITE_CHUNK_SIZE = 200;
export const ARCGIS_PAGE_SIZE = 1000;
export const ARCGIS_MAX_PAGES = 10;
export const MAX_RUN_ERROR_MESSAGE_CHARS = 1000;

export const LIMA_UTC_OFFSET_HOURS = -5;
export const HOURS_IN_HALF_DAY = 12;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export const SUTRAN_API_BASE = "https://api.sigea.sutran.gob.pe/public";
export const SUTRAN_ALT_ROUTES_GEOJSON_URL =
	"https://dm3mobsxe3icg.cloudfront.net/alt-routes-peru.geojson";
export const COEN_API_BASE =
	"https://coen.indeci.gob.pe/api/v2/mer/emergencies";
export const COEN_RECENT_DAYS = 2;
export const BOMBEROS_24H_URL = "https://sgonorte.bomberosperu.gob.pe/24horas/";
export const SENAMHI_MAPSERVER_BASE =
	"https://geosinpad.indeci.gob.pe/indeci/rest/services/Ent_Tecnico_Cientificas/SENAMHI/MapServer";
export const INDECI_MAPSERVER_BASE =
	"https://geosinpad.indeci.gob.pe/indeci/rest/services/Multisectorial/INDECI/MapServer";
export const IGP_LAST_QUAKE_LAYER_URL =
	"https://ide.igp.gob.pe/arcgis/rest/services/monitoreocensis/UltimoSismo/MapServer/0";
export const SERFOR_WILDFIRE_ALERTS_LAYER_URL =
	"https://geo.serfor.gob.pe/geoservicios/rest/services/Visor/Incendios_Forestales/MapServer/1";
export const SERFOR_LOOKBACK_DAYS = 3;

// Polygon simplification for SENAMHI warning areas: the raw layer weighs ~3.6 MB
// per request, which blows the Workers CPU budget just in JSON.parse. With
// ~1 km tolerance it drops under 50 KB and is still accurate for routing.
export const ARCGIS_GEOMETRY_PRECISION = 3;
export const ARCGIS_MAX_ALLOWABLE_OFFSET_DEG = 0.01;

export const EARTHQUAKE_WARNING_MAGNITUDE = 4.5;
export const EARTHQUAKE_CRITICAL_MAGNITUDE = 5.5;

// /ultimas-noticias is the archive of the current Lima day: it is empty right
// after midnight and the previous day's last hour drops off it before the next
// run. The RSS feed is a rolling list of the latest 60 articles across days.
export const RPP_FEED_URL = "https://rpp.pe/rss";
export const RPP_FETCH_CONCURRENCY = 5;
export const NEWS_RELEVANCE_THRESHOLD = 0.6;
export const NEWS_IN_PERU_THRESHOLD = 0.5;
export const NEWS_SEVERITY_CRITICAL_SCORE = 3;
export const NEWS_SEVERITY_WARNING_SCORE = 1.5;

export const JEV_MODEL = "jev-latest";

export const SRATMA_API_BASE = "https://sratma.mtc.gob.pe/wssratma/api/Mapa";
export const SRATMA_FETCH_CONCURRENCY = 5;
// SRATMA reports arrive days late, so only accidents this recent are worth
// asking Jev whether the road is still affected; older ones stay as context.
export const SRATMA_ROUTE_IMPACT_WINDOW_MS = 12 * MS_PER_HOUR;
export const SRATMA_PHOTO_PREFIX = "sratma/accidents/";

// Public Backblaze B2 bucket (S3-compatible API) for scraped media. Objects
// under `sratma/` are hidden after 45 days by a bucket lifecycle rule.
export const MEDIA_BUCKET_NAME = "illapa-media";
export const MEDIA_BUCKET_REGION = "us-west-004";
export const MEDIA_BUCKET_S3_ENDPOINT =
	"https://s3.us-west-004.backblazeb2.com";
export const MEDIA_BUCKET_PUBLIC_URL =
	"https://f004.backblazeb2.com/file/illapa-media";
export const MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";
