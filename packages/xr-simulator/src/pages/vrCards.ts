/**
 * Dev page (not shipped in apps/web): every VR card drawn by its real GUI code, face-on through
 * an orthographic camera at 1 web CSS px per screen px, in light (default) or dark
 * (`?theme=dark`), to compare with the web Card of /design-system (S12).
 */
import {
	Camera,
	Color4,
	Engine,
	FreeCamera,
	type Mesh,
	MeshBuilder,
	Scene,
	Vector3,
} from "@babylonjs/core";
import { AdvancedDynamicTexture } from "@babylonjs/gui";
import type { WeatherSnapshot } from "../map/weather/WeatherController";
import type { ResultActions } from "../playback/ResultActions";
import { createAppStore } from "../state/appState";
import {
	entryActions,
	pointCardContent,
	weatherMenuContent,
} from "../ui/sections";
import { vrButtonFace, vrTextCard } from "../ui/vr/faces";
import {
	BUTTON_HEIGHT_CSS_PX,
	MAYU_DARK,
	MAYU_LIGHT,
	metresOf,
	readVrTheme,
	texturePx,
	VR_METRES_PER_CSS_PX,
} from "../ui/vr/theme";
import { VrCreditLabel, VrInstructionsCard } from "../ui/vr/VrInfoCards";
import { VrPanel } from "../ui/vr/VrPanel";
import { VrPointCard } from "../ui/vr/VrPointCard";
import { VrWeatherMenu } from "../ui/vr/VrWeatherMenu";
import { vrCreditContent } from "../xr/credit";
import { controlsHint } from "../xr/vrMode";

const GAP_CSS_PX = 32;

const dark = new URLSearchParams(location.search).get("theme") === "dark";
for (const [token, value] of Object.entries(dark ? MAYU_DARK : MAYU_LIGHT))
	document.documentElement.style.setProperty(token, value);

await Promise.all(
	[
		'800 expanded 16px "Archivo"',
		'400 16px "Archivo"',
		'500 16px "Archivo"',
		'600 16px "Archivo"',
		'500 16px "JetBrains Mono"',
		'600 16px "JetBrains Mono"',
	].map((font) => document.fonts.load(font)),
);

const canvas = document.querySelector("canvas");
if (!canvas) throw new Error("vr-cards: no canvas");
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true }, true);
const scene = new Scene(engine);
const theme = readVrTheme();
scene.clearColor = Color4.FromHexString(`${theme.colors.background}FF`);
const camera = new FreeCamera("cards", new Vector3(0, 0, -10), scene);
camera.setTarget(Vector3.Zero());
camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
const frame = () => {
	const halfWidth = (canvas.clientWidth * VR_METRES_PER_CSS_PX) / 2;
	const halfHeight = (canvas.clientHeight * VR_METRES_PER_CSS_PX) / 2;
	camera.orthoLeft = -halfWidth;
	camera.orthoRight = halfWidth;
	camera.orthoTop = halfHeight;
	camera.orthoBottom = -halfHeight;
	return { halfWidth, halfHeight };
};

const snapshot: WeatherSnapshot = {
	backend: "ready",
	notice: null,
	layers: (
		[
			["clouds", "Nubes", "observado", true],
			["rain", "Lluvia", "pronóstico", true],
			["lightning", "Rayos", "observado", false],
			["cape", "Potencial convectivo", "pronóstico", false],
			["wind", "Viento", "pronóstico", false],
			["temperature", "Temperatura", "pronóstico", false],
		] as const
	).map(([id, title, kindLabel, enabled]) => ({
		id,
		title,
		kindLabel,
		group: null,
		enabled,
		disabled: false,
		opacity: 0.8,
		status: "ready",
		statusText: null,
	})),
	times: [{ id: "a", validTime: 0, forecastHour: 3 }],
	timeIndex: 0,
	playing: false,
	timeLabel: "2026-10-18 09:00 UTC",
	leadLabel: "Pronóstico +3 h",
	rainMode: "rate",
	provenance: [],
	attribution: "Nubes: NOAA GOES-19 ABI L2 · Lluvia: NOAA GFS",
	lightning: null,
};
const point = { lon: -77.0428, lat: -12.0464, height: 154 };
const entries = [{ id: "structures", label: "Simulador de estructuras" }];
const noop = () => {};

const pointCard = new VrPointCard(
	scene,
	{ simulate: noop, cancel: noop, setView: noop },
	entryActions(entries),
);
pointCard.update(
	pointCardContent({
		picked: point,
		busy: false,
		error: null,
		view: "vuelo",
		entries,
	}),
);
pointCard.showAt([0, 0, 0]);

const weatherMenu = new VrWeatherMenu(
	scene,
	weatherMenuContent(snapshot, []),
	noop,
	noop,
);
weatherMenu.showAt([0, 0, 0]);

const results: ResultActions = {
	toggleRecording: noop,
	setResultMode: noop,
	togglePlay: noop,
	step: noop,
	seek: noop,
	setSpeed: noop,
};
const panel = new VrPanel(
	scene,
	createAppStore({
		profile: "medium",
		emitterPosition: [0, 0],
		terrainLabel: "Chosica",
	}),
	{
		resetSimulation: noop,
		exitXr: noop,
		result: results,
		backToMap: noop,
		mapAvailable: () => true,
		showControls: noop,
		weather: { content: () => weatherMenuContent(snapshot, []), action: noop },
	},
);
panel.setStats(
	{
		simTime: 42,
		dt: 0.1,
		steps: 420,
		volume: 58_000,
		injectedVolume: 60_000,
		editRemovedVolume: 0,
		maxDepth: 2.31,
		maxSpeed: 4.2,
		minDepth: 0,
		wetCells: 1200,
	},
	1e-5,
);

const infoCard = (
	name: string,
	size: { width: number; height: number },
	build: (ui: AdvancedDynamicTexture) => void,
): Mesh => {
	const plane = MeshBuilder.CreatePlane(
		name,
		{ width: metresOf(size.width), height: metresOf(size.height) },
		scene,
	);
	const ui = AdvancedDynamicTexture.CreateForMesh(
		plane,
		texturePx(size.width),
		texturePx(size.height),
		false,
	);
	build(ui);
	return plane;
};
const instructions = new VrInstructionsCard(scene, noop);
instructions.showAt({ position: [0, 0, 0], yaw: 0 }, controlsHint("vuelo"));
const controls = instructions.mesh;
const creditLabel = new VrCreditLabel(scene);
creditLabel.show(
	vrCreditContent(
		{
			text: "Imagen: Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community · Powered by Esri",
			notice: null,
		},
		"Datos meteorológicos: Nubes: NOAA GOES-19 ABI L2",
	),
);
const credit = creditLabel.mesh;

// The structures XR maquette (packages/ui visuals.ts) draws its hint and buttons with these faces.
const structuresHint = infoCard(
	"structures-hint",
	{ width: 368, height: 96 },
	(ui) => {
		vrTextCard(
			ui,
			"Apunta a una mesa y aprieta el gatillo para colocar la maqueta",
		);
	},
);
const structuresButtons = (
	[
		["Deshacer", "outline"],
		["Salir de AR", "outline"],
		["Volver al mapa del Perú", "default"],
	] as const
).map(([label, variant], index) =>
	infoCard(
		`structures-button-${index}`,
		{ width: 224, height: BUTTON_HEIGHT_CSS_PX },
		(ui) => {
			vrButtonFace(ui, label, variant).paint({
				hovered: index === 1,
				pressed: false,
			});
		},
	),
);

const layout = () => {
	const { halfWidth, halfHeight } = frame();
	let left = -halfWidth + metresOf(GAP_CSS_PX);
	const top = halfHeight - metresOf(GAP_CSS_PX);
	const columns: Mesh[][] = [
		[pointCard.mesh],
		[weatherMenu.mesh],
		[panel.mesh],
		[controls, credit, structuresHint, ...structuresButtons],
	];
	for (const column of columns) {
		let columnTop = top;
		let columnWidth = 0;
		for (const mesh of column) {
			const extent = mesh.getBoundingInfo().boundingBox.extendSize;
			mesh.billboardMode = 0;
			mesh.position.set(left + extent.x, columnTop - extent.y, 0);
			columnTop -= extent.y * 2 + metresOf(GAP_CSS_PX);
			columnWidth = Math.max(columnWidth, extent.x * 2);
		}
		left += columnWidth + metresOf(GAP_CSS_PX);
	}
};
layout();
window.addEventListener("resize", () => {
	engine.resize();
	layout();
});
engine.runRenderLoop(() => scene.render());
