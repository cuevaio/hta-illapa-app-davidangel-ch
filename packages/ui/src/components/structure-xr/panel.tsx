import { Billboard, Text } from "@react-three/drei";
import { Suspense, useState } from "react";
import type { StructureXrLabels } from "../structure-xr";
import {
	PANEL_BUTTON_DEPTH_M,
	PANEL_BUTTON_GAP_M,
	PANEL_BUTTON_HEIGHT_M,
	PANEL_BUTTON_WIDTH_M,
	PANEL_FONT_SIZE_M,
	PANEL_OFFSET_X_M,
	PANEL_OFFSET_Y_M,
	PANEL_PRESSED_SCALE_RATIO,
	PANEL_TEXT_OFFSET_M,
} from "./constants";

interface StructureXrButtonProps {
	label: string;
	positionY: number;
	onClick: () => void;
	colors: Record<string, string>;
}

function StructureXrButton({
	label,
	positionY,
	onClick,
	colors,
}: StructureXrButtonProps) {
	const [hovered, setHovered] = useState(false);
	const [pressed, setPressed] = useState(false);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Three.js groups receive WebXR input rather than DOM events.
		<group
			position-y={positionY}
			scale={pressed ? PANEL_PRESSED_SCALE_RATIO : 1}
			onPointerOver={(event) => {
				event.stopPropagation();
				setHovered(true);
			}}
			onPointerOut={() => {
				setHovered(false);
				setPressed(false);
			}}
			onPointerDown={(event) => {
				event.stopPropagation();
				setPressed(true);
			}}
			onPointerUp={(event) => {
				event.stopPropagation();
				setPressed(false);
			}}
			onPointerCancel={() => setPressed(false)}
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
		>
			<mesh name={`xr-button-${label}`}>
				<boxGeometry
					args={[
						PANEL_BUTTON_WIDTH_M,
						PANEL_BUTTON_HEIGHT_M,
						PANEL_BUTTON_DEPTH_M,
					]}
				/>
				<meshBasicMaterial
					color={hovered || pressed ? colors["--accent"] : colors["--card"]}
				/>
			</mesh>
			<Suspense fallback={null}>
				<Text
					position-z={PANEL_TEXT_OFFSET_M}
					fontSize={PANEL_FONT_SIZE_M}
					color={colors["--foreground"]}
					anchorX="center"
					anchorY="middle"
				>
					{label}
				</Text>
			</Suspense>
		</group>
	);
}

interface StructureXrPanelProps {
	labels: StructureXrLabels;
	onUndo: () => void;
	onExit: () => void;
	colors: Record<string, string>;
}

export function StructureXrPanel({
	labels,
	onUndo,
	onExit,
	colors,
}: StructureXrPanelProps) {
	return (
		<Billboard position={[PANEL_OFFSET_X_M, PANEL_OFFSET_Y_M, 0]}>
			<StructureXrButton
				label={labels.undo}
				positionY={(PANEL_BUTTON_HEIGHT_M + PANEL_BUTTON_GAP_M) / 2}
				onClick={onUndo}
				colors={colors}
			/>
			<StructureXrButton
				label={labels.exit}
				positionY={-(PANEL_BUTTON_HEIGHT_M + PANEL_BUTTON_GAP_M) / 2}
				onClick={onExit}
				colors={colors}
			/>
		</Billboard>
	);
}
