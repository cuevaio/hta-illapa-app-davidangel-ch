"use client";

import { Color3, Engine, Scene } from "@babylonjs/core";
import { PE22_TERRAIN_ORIGIN } from "@hack-the-andes-project/business/structures/landmarks";
import {
	createBabylonTerrain,
	TERRAIN_ATTRIBUTION,
} from "@hack-the-andes-project/terrain/babylon/terrain";
import type { BabylonTerrain } from "@hack-the-andes-project/terrain/babylon/types";
import { useEffect, useRef, useState } from "react";
import { useTokenColors } from "../hooks/use-token-colors";
import { STRUCTURE_COLOR_TOKENS } from "../lib/structure-colors";
import type { BabylonStructureSceneProps } from "../lib/structure-scene";
import type { StructureXrController } from "../lib/structure-xr-babylon";
import { cn } from "../lib/utils";
import {
	DPR_MAX_RATIO,
	TERRAIN_LOAD_TIMEOUT_MS,
} from "./structure-scene-babylon/constants";
import type { ScenePalette } from "./structure-scene-babylon/models";
import { StructureSceneRuntime } from "./structure-scene-babylon/runtime";
import { createStructureXr } from "./structure-xr-babylon";

interface SceneResource {
	runtime: StructureSceneRuntime;
	palette: ScenePalette;
	xr: Promise<StructureXrController>;
	xrRequestId: number | undefined;
}

export function BabylonStructureScene(props: BabylonStructureSceneProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const resourceRef = useRef<SceneResource | null>(null);
	const latest = useRef(props);
	latest.current = props;
	const tokenColors = useTokenColors(STRUCTURE_COLOR_TOKENS);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let engine: Engine | undefined;
		let scene: Scene | undefined;
		let resource: SceneResource | undefined;
		let terrain: BabylonTerrain | undefined;
		let observer: ResizeObserver | undefined;
		let disposed = false;
		const loadingTimeout = window.setTimeout(
			() => resource?.runtime.setStatus("error"),
			TERRAIN_LOAD_TIMEOUT_MS,
		);
		const reportError = () => {
			if (disposed) return;
			setFailed(true);
			latest.current.onTerrainStatusChange("error");
		};
		canvas.addEventListener("webglcontextlost", reportError);
		latest.current.onTerrainStatusChange("loading");
		try {
			engine = new Engine(canvas, true, {
				preserveDrawingBuffer: false,
				stencil: true,
			});
			engine.setHardwareScalingLevel(
				1 / Math.min(window.devicePixelRatio || 1, DPR_MAX_RATIO),
			);
			scene = new Scene(engine);
			scene.useRightHandedSystem = true;
			const palette: ScenePalette = {
				color: () => Color3.White(),
				css: () => "white",
			};
			terrain = createBabylonTerrain({
				scene,
				origin: PE22_TERRAIN_ORIGIN,
				onTilesLoaded: () => {
					if (disposed) return;
					resource?.runtime.markTerrainDirty();
					if (
						resource &&
						resource.runtime.terrain.heightAt({ x: 0, z: 0 }) !== null
					)
						window.clearTimeout(loadingTimeout);
				},
			});
			const runtime = new StructureSceneRuntime(
				scene,
				terrain,
				latest.current,
				palette,
			);
			const activeTerrain = terrain;
			const xr = createStructureXr({
				scene,
				terrain: activeTerrain,
				content: runtime.content,
				getFocus: () => {
					const selected = latest.current.structures.find(
						(structure) => structure.id === latest.current.selectedStructureId,
					);
					return selected ? activeTerrain.toLocal(selected.anchor) : null;
				},
				labels: {
					placeTable: latest.current.labels.placeTable,
					undo: latest.current.labels.undo,
					exit: latest.current.labels.exitXr,
					error: latest.current.labels.terrainError,
				},
				onUndo: () => latest.current.onUndo(),
				onSupportChange: (supported) => {
					if (!disposed) latest.current.onXrSupportChange(supported);
				},
				onSessionChange: (active) => {
					if (!disposed) {
						runtime.setPresenting(active);
						latest.current.onXrSessionChange(active);
					}
				},
				onError: () => {
					if (!disposed)
						runtime.labels.setStatus(latest.current.labels.terrainError);
				},
			});
			resource = { runtime, palette, xr, xrRequestId: undefined };
			resourceRef.current = resource;
			const activeEngine = engine;
			const activeScene = scene;
			observer = new ResizeObserver(() => {
				activeEngine.setHardwareScalingLevel(
					1 / Math.min(window.devicePixelRatio || 1, DPR_MAX_RATIO),
				);
				activeEngine.resize();
			});
			observer.observe(canvas);
			engine.onCanvasBlurObservable.add(() => runtime.clearPointer());
			engine.runRenderLoop(() => {
				if (disposed) return;
				try {
					activeScene.render();
				} catch {
					reportError();
					activeEngine.stopRenderLoop();
				}
			});
		} catch {
			reportError();
		}
		return () => {
			disposed = true;
			window.clearTimeout(loadingTimeout);
			canvas.removeEventListener("webglcontextlost", reportError);
			observer?.disconnect();
			resourceRef.current = null;
			engine?.stopRenderLoop();
			if (resource) {
				void resource.xr.then((controller) => controller.dispose());
				resource.runtime.dispose();
			} else terrain?.dispose();
			scene?.dispose();
			engine?.dispose();
		};
	}, []);

	useEffect(() => {
		const resource = resourceRef.current;
		if (!resource) return;
		const conversionCanvas = document.createElement("canvas");
		conversionCanvas.width = 1;
		conversionCanvas.height = 1;
		const context = conversionCanvas.getContext("2d", {
			willReadFrequently: true,
		});
		const colors = new Map<string, Color3>();
		const cssColors = new Map<string, string>();
		for (const token of STRUCTURE_COLOR_TOKENS) {
			const cssColor =
				tokenColors[token] ||
				getComputedStyle(document.documentElement)
					.getPropertyValue(token)
					.trim();
			if (!context || !cssColor) continue;
			context.clearRect(0, 0, 1, 1);
			context.fillStyle = cssColor;
			context.fillRect(0, 0, 1, 1);
			const pixels = context.getImageData(0, 0, 1, 1).data;
			const color = Color3.FromInts(
				pixels[0] ?? 0,
				pixels[1] ?? 0,
				pixels[2] ?? 0,
			);
			colors.set(token, color);
			cssColors.set(token, color.toHexString());
		}
		resource.palette = {
			color: (token) => colors.get(token) ?? Color3.White(),
			css: (token) => cssColors.get(token) ?? "white",
		};
		resource.runtime.update(latest.current, resource.palette);
	}, [tokenColors]);

	useEffect(() => {
		const resource = resourceRef.current;
		if (!resource) return;
		resource.runtime.update(props, resource.palette);
		if (props.xrRequest && props.xrRequest.requestId !== resource.xrRequestId) {
			resource.xrRequestId = props.xrRequest.requestId;
			void resource.xr
				.then((controller) => {
					if (resourceRef.current === resource) return controller.enter();
				})
				.catch(() =>
					resource.runtime.labels.setStatus(latest.current.labels.terrainError),
				);
		}
	}, [props]);

	return (
		<div className={cn("relative size-full overflow-hidden", props.className)}>
			<canvas
				ref={canvasRef}
				aria-label={props.labels.canvas}
				role="img"
				tabIndex={0}
				className="block size-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
			/>
			<div className="pointer-events-none absolute bottom-2 left-2 max-w-full bg-background/80 px-2 py-1 text-muted-foreground text-xs">
				{TERRAIN_ATTRIBUTION}
			</div>
			{failed ? (
				<div
					role="alert"
					className="absolute inset-0 flex items-center justify-center bg-background p-4 text-foreground"
				>
					{props.labels.terrainError}
				</div>
			) : null}
		</div>
	);
}
