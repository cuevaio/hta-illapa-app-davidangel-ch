import "../../pages/base.css";
import {
	ArcRotateCamera,
	Color3,
	Color4,
	ComputeShader,
	Constants,
	HemisphericLight,
	MeshBuilder,
	Scene,
	StandardMaterial,
	StorageBuffer,
	Vector3,
	WebGPUEngine,
	WebXRFeatureName,
	WebXRSessionManager,
	WebXRState,
} from "@babylonjs/core";
import { AdvancedDynamicTexture, TextBlock } from "@babylonjs/gui";
import { TestOverlay } from "./overlay";

// One invocation bumps a counter each frame: proves compute keeps running inside XR.
const COUNTER_WGSL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> counter : array<f32>;
@compute @workgroup_size(1)
fn main() { counter[0] = counter[0] + 1.0; }
`;

async function main() {
	const overlay = new TestOverlay(
		document.getElementById("overlay")!,
		"Prueba XR · Babylon WebGPUEngine",
	);
	const canvas = document.getElementById("scene") as HTMLCanvasElement;

	if (!(await WebGPUEngine.IsSupportedAsync)) {
		overlay.write("WebGPU no soportado: esta prueba requiere WebGPU.");
		return;
	}
	const engine = new WebGPUEngine(canvas, { xrCompatible: true });
	await engine.initAsync();
	overlay.write(
		`WebGPUEngine inicializado (xrCompatible). Babylon ${WebGPUEngine.Version}`,
	);

	const scene = new Scene(engine);
	scene.clearColor = new Color4(0.06, 0.07, 0.09, 1);
	const camera = new ArcRotateCamera(
		"cam",
		-Math.PI / 2,
		1.1,
		6,
		new Vector3(0, 1, 0),
		scene,
	);
	camera.attachControl(canvas, true);
	new HemisphericLight("light", new Vector3(0.3, 1, 0.2), scene);
	const ground = MeshBuilder.CreateGround(
		"ground",
		{ width: 8, height: 8 },
		scene,
	);
	const groundMat = new StandardMaterial("groundMat", scene);
	groundMat.diffuseColor = new Color3(0.35, 0.28, 0.2);
	ground.material = groundMat;
	const box = MeshBuilder.CreateBox("box", { size: 0.4 }, scene);
	box.position.set(0, 1.2, 1.5);

	const panel = MeshBuilder.CreatePlane(
		"panel",
		{ width: 1.2, height: 0.6 },
		scene,
	);
	panel.position.set(0, 1.6, 2.2);
	const ui = AdvancedDynamicTexture.CreateForMesh(panel, 1024, 512);
	const label = new TextBlock("label", "");
	label.color = "white";
	label.fontSize = 44;
	ui.addControl(label);

	const counter = new StorageBuffer(
		engine,
		4,
		Constants.BUFFER_CREATIONFLAG_STORAGE |
			Constants.BUFFER_CREATIONFLAG_READ |
			Constants.BUFFER_CREATIONFLAG_WRITE,
	);
	counter.update(new Float32Array([0]));
	const cs = new ComputeShader(
		"counter",
		engine,
		{ computeSource: COUNTER_WGSL },
		{
			bindingsMapping: { counter: { group: 0, binding: 0 } },
		},
	);
	cs.setStorageBuffer("counter", counter);
	await cs.dispatchWhenReady(1);

	let computeTicks = 0;
	let xrFrames = 0;
	let mode = "escritorio";
	scene.onBeforeRenderObservable.add(() => {
		cs.dispatch(1);
		box.rotation.y += engine.getDeltaTime() * 0.001;
	});
	setInterval(async () => {
		const view = await counter.read(undefined, undefined, undefined, true);
		computeTicks = new Float32Array(view.buffer, view.byteOffset, 1)[0];
		label.text = `Modo: ${mode}\nCompute ticks: ${computeTicks}\nFrames XR: ${xrFrames}\nFPS: ${engine.getFps().toFixed(0)}`;
	}, 1000);
	engine.runRenderLoop(() => scene.render());
	window.addEventListener("resize", () => engine.resize());

	const [vr, ar] = await Promise.all([
		WebXRSessionManager.IsSessionSupportedAsync("immersive-vr"),
		WebXRSessionManager.IsSessionSupportedAsync("immersive-ar"),
	]);
	overlay.write(
		`immersive-vr: ${vr} · immersive-ar: ${ar} · IsWebGPUXRSupported: ${WebXRSessionManager.IsWebGPUXRSupported}`,
	);
	if (!vr && !ar) {
		overlay.write(
			'Sin soporte de sesión inmersiva: no se muestra el botón "Entrar en VR".',
		);
		return;
	}

	const xr = await scene.createDefaultXRExperienceAsync({
		disableDefaultUI: true,
		floorMeshes: [ground],
	});
	xr.baseExperience.featuresManager.enableFeature(
		WebXRFeatureName.LAYERS,
		"stable",
	);
	xr.baseExperience.sessionManager.onXRFrameObservable.add(() => xrFrames++);
	xr.baseExperience.onStateChangedObservable.add((state) => {
		overlay.write(`Estado XR: ${WebXRState[state]}`);
		if (state === WebXRState.NOT_IN_XR) {
			mode = "escritorio";
			scene.clearColor = new Color4(0.06, 0.07, 0.09, 1);
			overlay.write(
				`Salida de XR. Frames XR: ${xrFrames}, compute ticks: ${computeTicks}. La escena sigue renderizando.`,
			);
		}
	});

	const enter = async (sessionMode: XRSessionMode) => {
		try {
			xrFrames = 0;
			mode = sessionMode;
			if (sessionMode === "immersive-ar")
				scene.clearColor = new Color4(0, 0, 0, 0);
			await xr.baseExperience.enterXRAsync(sessionMode, "local-floor");
			overlay.write(`Sesión ${sessionMode} iniciada.`);
		} catch (err) {
			mode = "escritorio";
			overlay.write(`No se pudo iniciar ${sessionMode}: ${String(err)}`);
		}
	};
	if (vr) overlay.addButton("Entrar en VR", () => enter("immersive-vr"));
	if (ar) overlay.addButton("Entrar en AR", () => enter("immersive-ar"));
}

main().catch((err) => {
	document.getElementById("overlay")!.append(`Error: ${String(err)}`);
	console.error(err);
});
