import "./app.css";
import { createXrViewer } from "../viewer/createXrViewer";

const root = document.getElementById("app")!;
const loading = document.createElement("div");
loading.className = "loading";
loading.textContent = "Preparando simulador…";
root.append(loading);

const handle = createXrViewer(root);
handle.ready
	.then(() => {
		loading.remove();
		// Debug/verification hooks of the standalone page only (window.__app.huayco.mapContextStats()…).
		Object.assign(window, {
			__app: {
				viewer: handle.viewer,
				huayco: handle.mode("huayco"),
				overview: handle.viewer.overview,
				weather: handle.viewer.weather,
			},
		});
	})
	.catch((err: unknown) => {
		console.error(err);
		loading.remove();
		const box = document.createElement("section");
		box.className = "notice notice-error app-error";
		box.innerHTML =
			'<h2>No se pudo iniciar el simulador</h2><p class="msg"></p><p><a href="./diagnostics.html">Abrir el diagnóstico</a></p>';
		box.querySelector(".msg")!.textContent = String(err);
		root.append(box);
	});
