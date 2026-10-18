import { Edges, Line } from "@react-three/drei";
import type { ComponentProps } from "react";

interface DecorativeLineProps
	extends Omit<ComponentProps<typeof Line>, "raycast" | "pointerEvents"> {}
interface DecorativeEdgesProps
	extends Omit<ComponentProps<typeof Edges>, "raycast" | "pointerEvents"> {}

export function DecorativeLine(props: DecorativeLineProps) {
	return <Line {...props} raycast={ignoreRaycast} pointerEvents="none" />;
}

export function DecorativeEdges(props: DecorativeEdgesProps) {
	return <Edges {...props} raycast={ignoreRaycast} pointerEvents="none" />;
}

export function ignoreRaycast() {
	return null;
}
