import "./base.css";
import { runBabylonComputeTest } from "../platform/babylonComputeTest";
import {
	KEY_LIMITS,
	probeCapabilities,
	summarize,
} from "../platform/capabilities";
import {
	type ComputeTestResult,
	runRawWebGpuComputeTest,
} from "../platform/gpuSmokeTest";
import { renderWebGpuUnavailable } from "../ui/web/unsupported";

type Cell = string | { text: string; cls: "ok" | "warn" | "err" };

const yes = (v: boolean | null | undefined, unknown = "desconocido"): Cell =>
	v === null || v === undefined
		? { text: unknown, cls: "warn" }
		: v
			? { text: "sí", cls: "ok" }
			: { text: "no", cls: "err" };

function card(title: string, rows: [string, Cell][]): HTMLElement {
	const el = document.createElement("section");
	el.className = "card";
	const h = document.createElement("h2");
	h.textContent = title;
	const table = document.createElement("table");
	for (const [label, value] of rows) {
		const tr = table.insertRow();
		const th = document.createElement("th");
		th.textContent = label;
		const td = tr.insertCell();
		tr.prepend(th);
		if (typeof value === "string") td.textContent = value;
		else {
			td.textContent = value.text;
			td.className = value.cls;
		}
	}
	el.append(h, table);
	return el;
}

function computeRows(
	r: ComputeTestResult | undefined,
	skipped: string,
): [string, Cell][] {
	if (!r) return [["Resultado", { text: skipped, cls: "warn" }]];
	return [
		[
			"Resultado",
			r.ok
				? { text: "correcto", cls: "ok" }
				: { text: r.error ?? `${r.mismatches} discrepancias`, cls: "err" },
		],
		["Elementos", String(r.elements)],
		["Muestra (in·2+1)", r.sample.join(", ")],
		["Tiempo total (incl. creación)", `${r.millis.toFixed(1)} ms`],
	];
}

async function main() {
	const app = document.getElementById("app")!;
	const status = document.createElement("p");
	status.textContent = "Analizando…";
	app.append(status);

	const report = await probeCapabilities();
	const summary = summarize(report);
	const hasGpu = report.gpu.adapterFound;
	const [raw, babylon] = hasGpu
		? await Promise.all([runRawWebGpuComputeTest(), runBabylonComputeTest()])
		: [undefined, undefined];
	status.remove();

	if (!hasGpu) renderWebGpuUnavailable(app, report, false);

	app.append(
		card("Resumen", [
			["Dispositivo detectado", report.device],
			[
				"Backend del solver",
				summary.solverBackend === "webgpu"
					? { text: "WebGPU", cls: "ok" }
					: { text: "alternativo (sin WebGPU)", cls: "warn" },
			],
			[
				"Perfil de calidad por defecto",
				`${summary.defaultQuality.id} (${summary.defaultQuality.solverResolution}², ${summary.defaultQuality.targetFps} fps)`,
			],
			["Botón “Entrar en VR”", yes(summary.showVrButton)],
			["Botón “Entrar en AR”", yes(summary.showArButton)],
			[
				"XR sobre WebGPU",
				summary.showVrButton
					? summary.xrNeedsWebGLRenderer
						? { text: "no: XR requeriría WebGL", cls: "warn" }
						: { text: "sí", cls: "ok" }
					: "—",
			],
		]),
		card("WebGPU", [
			["navigator.gpu", yes(report.gpu.apiPresent)],
			["Adaptador", yes(report.gpu.adapterFound)],
			["Adaptador de software (fallback)", yes(report.gpu.isFallbackAdapter)],
			[
				"Fabricante / arquitectura",
				report.gpu.adapterInfo?.vendor
					? `${report.gpu.adapterInfo.vendor} / ${report.gpu.adapterInfo.architecture}`
					: "no expuesto por el navegador",
			],
			[
				"Descripción",
				report.gpu.adapterInfo?.description ||
					report.gpu.adapterInfo?.device ||
					"—",
			],
			["Error", report.gpu.error ?? "—"],
			...KEY_LIMITS.map((k): [string, Cell] => [
				k,
				report.gpu.limits[k]?.toLocaleString("es") ?? "—",
			]),
			["Features", report.gpu.features.join(", ") || "—"],
		]),
		card(
			"Compute de prueba (WebGPU directo)",
			computeRows(raw, "omitido: sin WebGPU"),
		),
		card(
			"Compute de prueba (Babylon ComputeShader)",
			computeRows(babylon, "omitido: sin WebGPU"),
		),
		card("WebXR", [
			["Contexto seguro (HTTPS/localhost)", yes(report.xr.secureContext)],
			["navigator.xr", yes(report.xr.apiPresent)],
			["immersive-vr", yes(report.xr.immersiveVr, "no consultado")],
			["immersive-ar", yes(report.xr.immersiveAr, "no consultado")],
			["XRGPUBinding (WebXR + WebGPU)", yes(report.xr.gpuBinding)],
			[
				"XRGPUSubImage.getViewDescriptor",
				yes(report.xr.gpuSubImageViewDescriptor),
			],
			["Error", report.xr.error ?? "—"],
		]),
		card("Pantalla", [
			["User agent", report.userAgent],
			[
				"Pantalla",
				`${report.screen.width}×${report.screen.height} @${report.devicePixelRatio}x`,
			],
			["Táctil", yes(report.touch)],
		]),
	);

	const links = document.createElement("section");
	links.className = "card";
	links.innerHTML = `<h2>Pruebas XR</h2>
    <div class="row"><a href="./xr-babylon.html">Babylon (WebGPUEngine)</a></div>
    <div class="row"><button id="copy">Copiar informe JSON</button></div>
    <pre id="json"></pre>`;
	app.append(links);
	const json = JSON.stringify(
		{ report, summary, compute: { raw, babylon } },
		null,
		2,
	);
	links.querySelector("#json")!.textContent = json;
	links.querySelector<HTMLButtonElement>("#copy")!.onclick = async (ev) => {
		const btn = ev.currentTarget as HTMLButtonElement;
		try {
			await navigator.clipboard.writeText(json);
			btn.textContent = "Copiado";
		} catch {
			btn.textContent = "No se pudo copiar: selecciona el texto";
		}
	};
	(window as unknown as { __diagnostics: unknown }).__diagnostics = {
		report,
		summary,
		compute: { raw, babylon },
	};
}

main().catch((err) => {
	const app = document.getElementById("app")!;
	const box = document.createElement("section");
	box.className = "notice notice-error";
	box.textContent = `El diagnóstico falló: ${String(err)}`;
	app.append(box);
});
