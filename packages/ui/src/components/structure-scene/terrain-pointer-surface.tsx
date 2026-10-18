import type { Terrain } from "@hack-the-andes-project/terrain/types";
import { useEffect, useMemo } from "react";
import { BufferGeometry, Mesh, MeshBasicMaterial } from "three";

import type { TerrainPicker } from "./picking";

interface TerrainPointerSurfaceProps {
	terrain: Terrain;
	picker: TerrainPicker;
}
export function TerrainPointerSurface({
	terrain,
	picker,
}: TerrainPointerSurfaceProps) {
	const surface = useMemo(() => {
		const surface = new Mesh(
			new BufferGeometry(),
			new MeshBasicMaterial({ visible: false }),
		);
		surface.name = "structure-terrain-pick-surface";
		surface.frustumCulled = false;
		surface.raycast = (raycaster, intersections) => {
			const point = picker.pick(raycaster.ray);
			if (!point) return;
			const worldPoint = terrain.group.localToWorld(point.clone());
			const distance = worldPoint.distanceTo(raycaster.ray.origin);
			if (distance >= raycaster.near && distance <= raycaster.far)
				intersections.push({ distance, point: worldPoint, object: surface });
		};
		return surface;
	}, [terrain, picker]);
	useEffect(
		() => () => {
			surface.geometry.dispose();
			surface.material.dispose();
		},
		[surface],
	);
	return <primitive object={surface} />;
}
