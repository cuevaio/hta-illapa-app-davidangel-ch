"use client";

import { Color3 } from "@babylonjs/core";
import {
	createXrViewer,
	type ViewerScreen,
} from "@hack-the-andes-project/xr-simulator/viewer";
import { useEffect, useRef, useState } from "react";
import { useTokenColors } from "../hooks/use-token-colors";
import { STRUCTURE_COLOR_TOKENS } from "../lib/structure-colors";
import type { StructureSceneProps } from "../lib/structure-scene";
import { cn } from "../lib/utils";
import {
	STRUCTURES_MODE_ID,
	StructuresMode,
} from "./structure-scene-babylon/mode";
import type { ScenePalette } from "./structure-scene-babylon/models";

export { STRUCTURES_MODE_ID };

export interface XrViewerProps {
	tilesBaseUrl: string;
	weatherBaseUrl: string;
	credentials: RequestCredentials;
	/** Overview button that opens the structures simulator at its origin. */
	structuresLabel: string;
	structures: StructureSceneProps;
	/** Opens the structures simulator instead of the Peru map once built. */
	openStructures: boolean;
	/** Bumped to download the structures terrain again after an error. */
	terrainRetryRequest: number;
	/** Bumped to switch to the structures simulator (e.g. a structure route opened later). */
	structuresRequest: number;
	/** Bumped to go back to the Peru map. */
	overviewRequest: number;
	failureLabel: string;
	onScreenChange: (screen: ViewerScreen) => void;
	className?: string;
}

const WHITE_PALETTE: ScenePalette = {
	color: () => Color3.White(),
	css: () => "white",
};

/** The xr-simulator viewer (Peru map, huayco simulator, shared VR) hosting the structures simulator. */
export function XrViewer(props: XrViewerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const modeRef = useRef<StructuresMode | null>(null);
	const handleRef = useRef<ReturnType<typeof createXrViewer> | null>(null);
	const paletteRef = useRef(WHITE_PALETTE);
	const latest = useRef(props);
	latest.current = props;
	const tokenColors = useTokenColors(STRUCTURE_COLOR_TOKENS);
	const [failed, setFailed] = useState(false);
	const { tilesBaseUrl, weatherBaseUrl, credentials } = props;

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const handle = createXrViewer(container, {
			tilesBaseUrl,
			weatherBaseUrl,
			credentials,
			initialMode: latest.current.openStructures
				? STRUCTURES_MODE_ID
				: undefined,
			onScreenChange: (screen) => latest.current.onScreenChange(screen),
			modes: [
				(host) => {
					const mode = new StructuresMode(host, {
						entryLabel: latest.current.structuresLabel,
						props: () => latest.current.structures,
						palette: () => paletteRef.current,
					});
					modeRef.current = mode;
					return mode;
				},
			],
		});
		handleRef.current = handle;
		handle.ready.catch(() => {
			if (handleRef.current === handle) setFailed(true);
		});
		return () => {
			handleRef.current = null;
			modeRef.current = null;
			handle.dispose();
		};
	}, [tilesBaseUrl, weatherBaseUrl, credentials]);

	useEffect(() => {
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
		paletteRef.current = {
			color: (token) => colors.get(token) ?? Color3.White(),
			css: (token) => cssColors.get(token) ?? "white",
		};
		modeRef.current?.update(latest.current.structures, paletteRef.current);
	}, [tokenColors]);

	useEffect(() => {
		modeRef.current?.update(props.structures, paletteRef.current);
	}, [props.structures]);

	useEffect(() => {
		if (props.terrainRetryRequest) modeRef.current?.retryTerrain();
	}, [props.terrainRetryRequest]);

	useEffect(() => {
		if (props.overviewRequest) handleRef.current?.showOverview();
	}, [props.overviewRequest]);

	useEffect(() => {
		const handle = handleRef.current;
		if (!props.structuresRequest || !handle) return;
		void handle.ready
			.then(() => {
				if (handleRef.current === handle)
					return handle.openMode(STRUCTURES_MODE_ID);
			})
			.catch(() => undefined);
	}, [props.structuresRequest]);

	return (
		<div className={cn("relative size-full overflow-hidden", props.className)}>
			<div
				ref={containerRef}
				role="application"
				aria-label={props.structures.labels.canvas}
				className="absolute inset-0 touch-none"
			/>
			{failed ? (
				<div
					role="alert"
					className="absolute inset-0 flex items-center justify-center bg-background p-4 text-foreground"
				>
					{props.failureLabel}
				</div>
			) : null}
		</div>
	);
}
