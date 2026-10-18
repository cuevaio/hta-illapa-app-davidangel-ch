// Backend diagnostics: canvas 2D slippy map of our own /tiles API (no external libraries or CDNs).
// Hillshade of the 512 px Terrarium tiles, cache status + latency per tile, height under the cursor,
// attribution from /capas and a primary vs fallback comparison at the same point.
(() => {
	const params = new URLSearchParams(location.search);
	const API = (params.get("api") || "").replace(/\/$/, "");
	const LAYERS = [
		params.get("primaria") || "terreno",
		params.get("respaldo") || "terreno-copernicus",
	];
	const TILE = 512; // a z tile of 512 px covers the 256 px XYZ tile z
	const NODATA = -32767;
	const POINTS = {
		Lima: [-77.0428, -12.0464],
		Cusco: [-71.9675, -13.532],
		Huascarán: [-77.6045, -9.1222],
		Titicaca: [-69.55, -15.85],
		Tacna: [-70.2536, -18.0146],
		Tarapoto: [-76.3733, -6.4825],
		Iquitos: [-73.2472, -3.7491],
	};
	const css = (n) =>
		getComputedStyle(document.documentElement).getPropertyValue(n).trim();

	// initial view, overridable with ?lon=&lat=&z= (e.g. ?lon=-77.6045&lat=-9.1222&z=11)
	const num = (k, d) =>
		Number.isFinite(Number.parseFloat(params.get(k)))
			? Number.parseFloat(params.get(k))
			: d;
	const view = {
		lon: num("lon", -75.0),
		lat: num("lat", -9.5),
		z: Math.max(0, Math.min(14, Math.round(num("z", 5)))),
	};
	const catalog = {};
	const panes = LAYERS.map((layer, i) => ({
		layer,
		version: "v1",
		canvas: document.getElementById(`c${i}`),
		stats: document.getElementById(`s${i}`),
		attr: document.getElementById(`a${i}`),
		zlabel: document.getElementById(`z${i}`),
		tiles: new Map(),
		zmin: 0,
		zmax: 14,
		zreal: 11,
	}));
	document.getElementById("t0").textContent = `${LAYERS[0]} (primaria)`;
	document.getElementById("t1").textContent = `${LAYERS[1]} (respaldo)`;

	// ---------------------------------------------------------------- projection
	const worldPx = (z) => TILE * 2 ** z;
	const project = (lon, lat, z) => {
		const s = Math.sin(
			(Math.max(Math.min(lat, 85.05), -85.05) * Math.PI) / 180,
		);
		return [
			((lon + 180) / 360) * worldPx(z),
			(0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldPx(z),
		];
	};
	const unproject = (px, py, z) => {
		const lon = (px / worldPx(z)) * 360 - 180;
		const n = Math.PI - (2 * Math.PI * py) / worldPx(z);
		return [lon, (180 / Math.PI) * Math.atan(Math.sinh(n))];
	};

	// ---------------------------------------------------------------- tiles
	let active = 0;
	const queue = [];
	function pump() {
		while (active < 6 && queue.length) {
			const job = queue.shift();
			active++;
			job().finally(() => {
				active--;
				pump();
			});
		}
	}

	function decodeTerrarium(img) {
		const c = new OffscreenCanvas(img.width, img.height);
		const g = c.getContext("2d", { willReadFrequently: true });
		g.drawImage(img, 0, 0);
		const d = g.getImageData(0, 0, img.width, img.height).data;
		const h = new Float32Array(img.width * img.height);
		for (let i = 0, j = 0; i < h.length; i++, j += 4) {
			const v = d[j] * 256 + d[j + 1] + d[j + 2] / 256 - 32768;
			h[i] = v <= NODATA ? Number.NaN : v;
		}
		return h;
	}

	function hillshade(h, z, y) {
		const n = TILE;
		const out = new ImageData(n, n);
		const px = out.data;
		const lat = unproject(0, (y + 0.5) * TILE, z)[1];
		const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / worldPx(z);
		const az = (315 * Math.PI) / 180;
		const alt = (45 * Math.PI) / 180;
		const at = (x, yy) =>
			h[Math.min(n - 1, Math.max(0, yy)) * n + Math.min(n - 1, Math.max(0, x))];
		for (let yy = 0; yy < n; yy++) {
			for (let x = 0; x < n; x++) {
				const i = (yy * n + x) * 4;
				const v = h[yy * n + x];
				if (Number.isNaN(v)) {
					px[i] = 255;
					px[i + 1] = 0;
					px[i + 2] = 255;
					px[i + 3] = 255;
					continue;
				}
				const dzdx = (at(x + 1, yy) - at(x - 1, yy)) / (2 * mpp);
				const dzdy = (at(x, yy + 1) - at(x, yy - 1)) / (2 * mpp);
				const slope = Math.atan(Math.hypot(dzdx, dzdy));
				const aspect = Math.atan2(dzdy, -dzdx);
				let s =
					Math.sin(alt) * Math.cos(slope) +
					Math.cos(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect);
				s = Math.max(0, s);
				// hypsometric tint: sea blue, lowlands green, highlands brown, peaks white
				let r;
				let g;
				let b;
				if (v <= 0.5) {
					r = 90;
					g = 140;
					b = 200;
				} else if (v < 500) {
					r = 110;
					g = 160;
					b = 90;
				} else if (v < 2500) {
					const t = (v - 500) / 2000;
					r = 110 + 90 * t;
					g = 160 - 30 * t;
					b = 90;
				} else if (v < 4800) {
					const t = (v - 2500) / 2300;
					r = 200 - 50 * t;
					g = 130 - 30 * t;
					b = 90 + 10 * t;
				} else {
					const t = Math.min(1, (v - 4800) / 1500);
					r = 150 + 105 * t;
					g = 100 + 155 * t;
					b = 100 + 155 * t;
				}
				const k = 0.35 + 0.75 * s;
				px[i] = Math.min(255, r * k);
				px[i + 1] = Math.min(255, g * k);
				px[i + 2] = Math.min(255, b * k);
				px[i + 3] = 255;
			}
		}
		return out;
	}

	function requestTile(pane, z, x, y) {
		const key = `${z}/${x}/${y}`;
		if (pane.tiles.has(key)) return pane.tiles.get(key);
		const rec = { z, x, y, state: "loading" };
		pane.tiles.set(key, rec);
		if (pane.tiles.size > 400) {
			for (const k of pane.tiles.keys()) {
				if (pane.tiles.size <= 300) break;
				if (!k.startsWith(`${view.z}/`)) pane.tiles.delete(k);
			}
		}
		queue.push(async () => {
			const t0 = performance.now();
			try {
				const r = await fetch(
					`${API}/tiles/${pane.layer}/${pane.version}/${z}/${x}/${y}.png`,
				);
				rec.latency = performance.now() - t0;
				if (!r.ok) {
					rec.state = "error";
					rec.error =
						r.status === 404
							? "fuera"
							: (await r.json().catch(() => ({}))).error || String(r.status);
					rec.status = r.status;
				} else {
					rec.cache = r.headers.get("X-Cache") || "?";
					rec.min = r.headers.get("X-Tile-Min");
					rec.max = r.headers.get("X-Tile-Max");
					rec.overzoom = r.headers.get("X-Tile-Overzoom") === "1";
					rec.source = r.headers.get("X-Tile-Source");
					const img = await createImageBitmap(await r.blob());
					rec.heights = decodeTerrarium(img);
					const shaded = new OffscreenCanvas(TILE, TILE);
					shaded
						.getContext("2d")
						.putImageData(hillshade(rec.heights, z, y), 0, 0);
					rec.image = shaded;
					rec.state = "ok";
				}
			} catch (_e) {
				rec.state = "error";
				rec.error = "red";
				rec.latency = performance.now() - t0;
			}
			draw();
		});
		pump();
		return rec;
	}

	// ---------------------------------------------------------------- drawing
	let scheduled = false;
	function draw() {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			panes.forEach(drawPane);
		});
	}

	function drawPane(pane) {
		const cv = pane.canvas;
		const dpr = window.devicePixelRatio || 1;
		const w = cv.clientWidth;
		const h = cv.clientHeight;
		if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
			cv.width = Math.round(w * dpr);
			cv.height = Math.round(h * dpr);
		}
		const g = cv.getContext("2d");
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, w, h);
		pane.zlabel.textContent = `z${view.z}${view.z > pane.zreal ? " · sobremuestreo" : ""}`;
		if (view.z < pane.zmin || view.z > pane.zmax) {
			g.fillStyle = "#fff";
			g.font = "14px system-ui";
			g.fillText(
				`Esta capa sirve z${pane.zmin}–z${pane.zmax}; acerca o aleja el mapa.`,
				16,
				28,
			);
			pane.stats.textContent = "";
			return;
		}
		const [cx, cy] = project(view.lon, view.lat, view.z);
		const ox = cx - w / 2;
		const oy = cy - h / 2;
		const n = 2 ** view.z;
		const counts = { HIT: 0, MISS: 0, STALE: 0, error: 0 };
		const lat = [];
		const showGrid = document.getElementById("grid").checked;
		for (
			let ty = Math.floor(oy / TILE);
			ty <= Math.floor((oy + h) / TILE);
			ty++
		) {
			for (
				let tx = Math.floor(ox / TILE);
				tx <= Math.floor((ox + w) / TILE);
				tx++
			) {
				if (ty < 0 || ty >= n) continue;
				const x = ((tx % n) + n) % n;
				const rec = requestTile(pane, view.z, x, ty);
				const sx = tx * TILE - ox;
				const sy = ty * TILE - oy;
				if (rec.state === "ok") {
					g.drawImage(rec.image, sx, sy);
					counts[rec.cache] = (counts[rec.cache] || 0) + 1;
					lat.push(rec.latency);
				} else if (rec.state === "error" && rec.status !== 404) {
					counts.error++;
				}
				if (
					showGrid &&
					rec.state !== "loading" &&
					!(rec.state === "error" && rec.status === 404)
				) {
					const color =
						rec.state === "error"
							? css("--err")
							: rec.cache === "HIT"
								? css("--hit")
								: rec.cache === "STALE"
									? css("--stale")
									: css("--miss");
					g.strokeStyle = color;
					g.lineWidth = 2;
					g.strokeRect(sx + 1, sy + 1, TILE - 2, TILE - 2);
					g.fillStyle = "rgba(0,0,0,.55)";
					g.fillRect(sx + 4, sy + 4, 178, 34);
					g.fillStyle = color;
					g.font = "bold 12px system-ui";
					g.fillText(
						rec.state === "error"
							? `error ${rec.error}`
							: `${rec.cache} · ${rec.latency.toFixed(0)} ms${rec.overzoom ? " · overzoom" : ""}`,
						sx + 10,
						sy + 18,
					);
					g.fillStyle = "#fff";
					g.font = "11px system-ui";
					g.fillText(
						`${view.z}/${x}/${ty}${rec.state === "ok" ? `  ${rec.min}…${rec.max} m` : ""}`,
						sx + 10,
						sy + 32,
					);
				}
			}
		}
		const mean = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0;
		pane.stats.textContent = `HIT ${counts.HIT || 0} · MISS ${counts.MISS || 0} · STALE ${counts.STALE || 0} · errores ${counts.error} · latencia media ${mean.toFixed(0)} ms`;
	}

	function heightAt(pane, lon, lat) {
		if (view.z < pane.zmin || view.z > pane.zmax) return null;
		const [px, py] = project(lon, lat, view.z);
		const tx = Math.floor(px / TILE);
		const ty = Math.floor(py / TILE);
		const rec = pane.tiles.get(`${view.z}/${tx}/${ty}`);
		if (rec?.state !== "ok") return null;
		const i = Math.floor(py - ty * TILE) * TILE + Math.floor(px - tx * TILE);
		return rec.heights[i];
	}

	// ---------------------------------------------------------------- interaction
	function setZoom(requestedZoom, anchor) {
		const z = Math.max(0, Math.min(14, requestedZoom));
		if (z === view.z) return;
		if (anchor) {
			const [ax, ay] = anchor;
			const [cx, cy] = project(view.lon, view.lat, view.z);
			const f = 2 ** (z - view.z);
			const nx = (cx + ax) * f - ax;
			const ny = (cy + ay) * f - ay;
			[view.lon, view.lat] = unproject(nx, ny, z);
		}
		view.z = z;
		draw();
	}

	panes.forEach((pane) => {
		const cv = pane.canvas;
		let drag = null;
		cv.addEventListener("pointerdown", (e) => {
			drag = [e.clientX, e.clientY];
			cv.setPointerCapture(e.pointerId);
			cv.style.cursor = "grabbing";
		});
		cv.addEventListener("pointerup", () => {
			drag = null;
			cv.style.cursor = "grab";
		});
		cv.addEventListener("pointermove", (e) => {
			const rect = cv.getBoundingClientRect();
			if (drag) {
				const [cx, cy] = project(view.lon, view.lat, view.z);
				[view.lon, view.lat] = unproject(
					cx - (e.clientX - drag[0]),
					cy - (e.clientY - drag[1]),
					view.z,
				);
				drag = [e.clientX, e.clientY];
				draw();
			}
			const [cx, cy] = project(view.lon, view.lat, view.z);
			const [lon, lat] = unproject(
				cx - rect.width / 2 + (e.clientX - rect.left),
				cy - rect.height / 2 + (e.clientY - rect.top),
				view.z,
			);
			const fmt = (v) =>
				v == null ? "—" : Number.isNaN(v) ? "sin datos" : `${v.toFixed(1)} m`;
			const a = heightAt(panes[0], lon, lat);
			const b = heightAt(panes[1], lon, lat);
			const diff =
				a != null && b != null && !Number.isNaN(a) && !Number.isNaN(b)
					? ` · diferencia respaldo − primaria ${(b - a).toFixed(1)} m`
					: "";
			document.getElementById("readout").textContent =
				`lon ${lon.toFixed(5)}, lat ${lat.toFixed(5)} · z${view.z} · ${LAYERS[0]}: ${fmt(a)} · ${LAYERS[1]}: ${fmt(b)}${diff}`;
		});
		cv.addEventListener(
			"wheel",
			(e) => {
				e.preventDefault();
				const rect = cv.getBoundingClientRect();
				setZoom(view.z + (e.deltaY < 0 ? 1 : -1), [
					e.clientX - rect.left - rect.width / 2,
					e.clientY - rect.top - rect.height / 2,
				]);
			},
			{ passive: false },
		);
	});
	document.getElementById("zin").onclick = () => setZoom(view.z + 1);
	document.getElementById("zout").onclick = () => setZoom(view.z - 1);
	document.getElementById("grid").onchange = draw;
	const jumps = document.getElementById("jumps");
	for (const [name, [lon, lat]] of Object.entries(POINTS)) {
		const b = document.createElement("button");
		b.textContent = name;
		b.onclick = () => {
			view.lon = lon;
			view.lat = lat;
			view.z = 11;
			draw();
		};
		jumps.appendChild(b);
	}
	window.addEventListener("resize", draw);

	fetch(`${API}/capas`)
		.then((r) => r.json())
		.then((cat) => {
			for (const pane of panes) {
				const capa = cat.capas.find((c) => c.id === pane.layer);
				if (!capa) {
					pane.attr.textContent = "Capa no disponible en /capas";
					continue;
				}
				const v =
					capa.versiones.find((x) => x.version === capa.version_actual) ||
					capa.versiones[0];
				pane.version = v.version;
				pane.zmin = v.zoom_min;
				pane.zmax = v.zoom_max;
				pane.zreal = v.zoom_max_real;
				catalog[pane.layer] = v;
				pane.attr.textContent =
					`${v.fuente.nombre} · ${v.fuente.atribucion} · Licencia: ${v.fuente.licencia}` +
					` · ${v.limitaciones.join(" · ")}`;
			}
			draw();
		})
		.catch(() => {
			panes.forEach((p) => {
				p.attr.textContent = "No se pudo leer /capas";
			});
			draw();
		});
})();
