import {
	type Color3,
	Color4,
	Constants,
	Mesh,
	MeshBuilder,
	PBRMaterial,
	Quaternion,
	type Scene,
	StandardMaterial,
	TransformNode,
	Vector3,
	VertexData,
} from "@babylonjs/core";
import type { StructureMaterial } from "@hack-the-andes-project/business/structures/catalog";
import { bypassWidthM } from "@hack-the-andes-project/business/structures/geometry";
import type {
	PlacedStructure,
	StructurePoint,
	TunnelTemplate,
} from "../../lib/structure-scene";
import type { StructureTerrain } from "../../lib/structure-terrain";
import {
	ABUTMENT_DEPTH_M,
	COLUMN_SEGMENTS_COUNT,
	DECK_THICKNESS_M,
	HALF_RATIO,
	MARKING_SEGMENTS_COUNT,
	MATERIAL_ROUGHNESS_RATIO,
	MATERIAL_TOKEN_NAMES,
	MIN_GEOMETRY_LENGTH_M,
	OVERLAY_RENDER_GROUP_ID,
	PIER_WIDTH_M,
	RAIL_HEIGHT_M,
	RAIL_WIDTH_M,
	ROAD_DASH_M,
	ROAD_GAP_M,
	ROAD_LIFT_M,
	ROAD_MARKING_LIFT_M,
	ROAD_MARKING_WIDTH_M,
	ROAD_SAMPLE_SPACING_M,
	SELECTION_LINE_WIDTH_PX,
	STEEL_METALNESS_RATIO,
	TUNNEL_ARC_SEGMENTS_COUNT,
	TUNNEL_ARCH_WALL_RATIO,
	TUNNEL_LINING_M,
	TUNNEL_PORTAL_DEPTH_M,
} from "./constants";
import { elementRotation } from "./transforms";

export interface ScenePalette {
	color(token: string): Color3;
	css(token: string): string;
}

export interface StructureModel {
	root: TransformNode;
	meshes: Mesh[];
	elements: Map<string, TransformNode>;
	outline(
		color: Color3 | null,
		opacity?: number,
		elementId?: string | null,
	): void;
	dispose(): void;
}

export function spanRotation(
	start: StructurePoint,
	end: StructurePoint,
): Quaternion {
	const direction = new Vector3(
		end.x - start.x,
		end.y - start.y,
		end.z - start.z,
	).normalize();
	return direction.lengthSquared()
		? Quaternion.FromUnitVectorsToRef(
				Vector3.Forward(),
				direction,
				new Quaternion(),
			)
		: Quaternion.Identity();
}

export function createStructureModel(
	scene: Scene,
	structure: PlacedStructure,
	terrain: StructureTerrain,
	palette: ScenePalette,
	parent: TransformNode,
	opacity = 1,
): StructureModel {
	const root = new TransformNode("structure", scene);
	root.parent = parent;
	const anchor = terrain.toLocal(structure.anchor);
	root.position.set(anchor.x, structure.anchor.elevationM, anchor.z);
	const meshes: Mesh[] = [];
	const elements = new Map<string, TransformNode>();
	const materials = new Map<StructureMaterial, PBRMaterial>();
	const outlineMeshes: Mesh[] = [];
	const outlineMaterial = new StandardMaterial("structure-outline", scene);
	outlineMaterial.disableLighting = true;
	outlineMaterial.alpha = 0;
	outlineMaterial.disableColorWrite = true;
	outlineMaterial.disableDepthWrite = true;
	outlineMaterial.depthFunction = Constants.ALWAYS;
	outlineMaterial.backFaceCulling = false;
	let previousOutlineColor: string | null | undefined;
	let previousOutlineOpacity: number | undefined;
	let previousElementId: string | null | undefined;
	const material = (kind: StructureMaterial) => {
		let resource = materials.get(kind);
		if (!resource) {
			resource = new PBRMaterial(kind, scene);
			resource.albedoColor = palette
				.color(opacity < 1 ? "--primary" : MATERIAL_TOKEN_NAMES[kind])
				.toLinearSpace();
			resource.roughness = MATERIAL_ROUGHNESS_RATIO;
			resource.metallic = kind === "steel" ? STEEL_METALNESS_RATIO : 0;
			resource.alpha = opacity;
			resource.backFaceCulling = false;
			materials.set(kind, resource);
		}
		return resource;
	};
	const add = (
		mesh: Mesh,
		kind: StructureMaterial,
		meshParent: TransformNode = root,
	) => {
		mesh.parent = meshParent;
		mesh.material = material(kind);
		mesh.isPickable = opacity === 1;
		meshes.push(mesh);
		return mesh;
	};
	const span = (
		name: string,
		start: StructurePoint,
		end: StructurePoint,
		widthM: number,
		heightM: number,
		kind: StructureMaterial,
	) => {
		const mesh = add(
			MeshBuilder.CreateBox(
				name,
				{
					width: widthM,
					height: heightM,
					depth: Math.max(
						MIN_GEOMETRY_LENGTH_M,
						Vector3.Distance(
							new Vector3(start.x, start.y, start.z),
							new Vector3(end.x, end.y, end.z),
						),
					),
				},
				scene,
			),
			kind,
		);
		mesh.position.set(
			(start.x + end.x) * HALF_RATIO,
			(start.y + end.y) * HALF_RATIO,
			(start.z + end.z) * HALF_RATIO,
		);
		mesh.rotationQuaternion = spanRotation(start, end);
		return mesh;
	};
	const template = structure.template;
	if (template.kind === "bridge") {
		span(
			"bridge-deck",
			{
				...template.start,
				y: template.start.y - DECK_THICKNESS_M * HALF_RATIO,
			},
			{ ...template.end, y: template.end.y - DECK_THICKNESS_M * HALF_RATIO },
			template.deckWidthM,
			DECK_THICKNESS_M,
			template.deckMaterial,
		);
		const direction = new Vector3(
			template.end.x - template.start.x,
			0,
			template.end.z - template.start.z,
		).normalize();
		const yawRad = Math.atan2(direction.x, direction.z);
		const supports = [template.start, template.end];
		for (let pierIndex = 0; pierIndex < template.pierCount; pierIndex++) {
			const fraction = (pierIndex + 1) / (template.pierCount + 1);
			supports.push({
				x: template.start.x + (template.end.x - template.start.x) * fraction,
				y: template.start.y + (template.end.y - template.start.y) * fraction,
				z: template.start.z + (template.end.z - template.start.z) * fraction,
			});
		}
		for (const [supportIndex, point] of supports.entries()) {
			const groundM =
				(terrain.heightAt({
					x: point.x + root.position.x,
					z: point.z + root.position.z,
				}) ?? root.position.y) - root.position.y;
			const heightM = Math.max(
				DECK_THICKNESS_M,
				point.y - groundM - DECK_THICKNESS_M,
			);
			const abutment = supportIndex < 2;
			const support = add(
				MeshBuilder.CreateBox(
					abutment ? "bridge-abutment" : "bridge-pier",
					{
						width: abutment ? template.deckWidthM : PIER_WIDTH_M,
						depth: abutment ? ABUTMENT_DEPTH_M : PIER_WIDTH_M,
						height: heightM,
					},
					scene,
				),
				"concrete",
			);
			support.position.set(
				point.x,
				point.y - DECK_THICKNESS_M - heightM * HALF_RATIO,
				point.z,
			);
			support.rotation.y = yawRad;
		}
		for (const side of [-1, 1]) {
			const offsetX = -direction.z * template.deckWidthM * HALF_RATIO * side;
			const offsetZ = direction.x * template.deckWidthM * HALF_RATIO * side;
			span(
				"bridge-railing",
				{
					x: template.start.x + offsetX,
					y: template.start.y + RAIL_HEIGHT_M,
					z: template.start.z + offsetZ,
				},
				{
					x: template.end.x + offsetX,
					y: template.end.y + RAIL_HEIGHT_M,
					z: template.end.z + offsetZ,
				},
				RAIL_WIDTH_M,
				RAIL_WIDTH_M,
				"steel",
			);
		}
	}
	if (template.kind === "tunnel") {
		const tunnel = new TransformNode("tunnel-axis", scene);
		tunnel.parent = root;
		tunnel.position.set(template.start.x, template.start.y, template.start.z);
		tunnel.rotationQuaternion = spanRotation(template.start, template.end);
		const lengthM = Math.max(
			MIN_GEOMETRY_LENGTH_M,
			Vector3.Distance(
				new Vector3(template.start.x, template.start.y, template.start.z),
				new Vector3(template.end.x, template.end.y, template.end.z),
			),
		);
		for (const [name, depthM, offsetM] of [
			["tunnel-bore", lengthM, 0],
			["tunnel-portal-start", TUNNEL_PORTAL_DEPTH_M, 0],
			[
				"tunnel-portal-end",
				TUNNEL_PORTAL_DEPTH_M,
				Math.max(0, lengthM - TUNNEL_PORTAL_DEPTH_M),
			],
		] satisfies [string, number, number][]) {
			const bore = add(
				createTunnelShell(scene, name, template, depthM),
				"concrete",
				tunnel,
			);
			bore.position.z = offsetM;
		}
	}
	if (template.kind === "bypass") {
		const road = createRoadMesh(scene, structure, terrain);
		add(road.surface, "asphalt");
		const markingMaterial = new StandardMaterial("road-marking", scene);
		markingMaterial.diffuseColor = palette.color("--card");
		markingMaterial.alpha = opacity;
		for (const marking of road.markings) {
			marking.parent = root;
			marking.material = markingMaterial;
			marking.isPickable = false;
			meshes.push(marking);
		}
		root.onDisposeObservable.addOnce(() => markingMaterial.dispose());
	}
	for (const element of structure.elements) {
		const elementRoot = new TransformNode(`element:${element.id}`, scene);
		elementRoot.parent = root;
		elementRoot.position.set(
			element.position.x,
			element.position.y,
			element.position.z,
		);
		elementRoot.rotationQuaternion = elementRotation(element.rotationDeg);
		const mesh =
			element.kind === "column"
				? MeshBuilder.CreateCylinder(
						"primitive-column",
						{
							diameter: element.widthM,
							height: element.heightM,
							tessellation: COLUMN_SEGMENTS_COUNT,
						},
						scene,
					)
				: MeshBuilder.CreateBox(
						`primitive-${element.kind}`,
						{
							width: element.widthM,
							height: element.heightM,
							depth: element.depthM,
						},
						scene,
					);
		if (element.kind === "column")
			mesh.scaling.z = element.depthM / element.widthM;
		mesh.position.y = element.heightM * HALF_RATIO;
		add(mesh, element.material, elementRoot);
		elements.set(element.id, elementRoot);
	}
	return {
		root,
		meshes,
		elements,
		outline(color, highlightOpacity = 1, elementId = null) {
			const outlineColor = color?.toHexString() ?? null;
			if (
				previousOutlineColor === outlineColor &&
				previousOutlineOpacity === highlightOpacity &&
				previousElementId === elementId
			)
				return;
			previousOutlineColor = outlineColor;
			previousOutlineOpacity = highlightOpacity;
			previousElementId = elementId;
			for (const mesh of outlineMeshes) mesh.dispose();
			outlineMeshes.length = 0;
			if (!color) return;
			for (const mesh of meshes) {
				if (!mesh.isPickable) continue;
				const outline = mesh.clone(`${mesh.name}-outline`, mesh.parent, true);
				outline.isPickable = false;
				outline.material = outlineMaterial;
				outline.renderingGroupId = OVERLAY_RENDER_GROUP_ID;
				outline.enableEdgesRendering();
				const edgeColor =
					elementId && mesh.parent === elements.get(elementId)
						? palette.color("--primary")
						: color;
				outline.edgesColor = new Color4(
					edgeColor.r,
					edgeColor.g,
					edgeColor.b,
					highlightOpacity,
				);
				outline.edgesWidth = SELECTION_LINE_WIDTH_PX;
				if (outline.edgesRenderer)
					outline.edgesRenderer.lineShader.depthFunction = Constants.ALWAYS;
				outlineMeshes.push(outline);
			}
		},
		dispose() {
			root.dispose();
			for (const resource of materials.values()) resource.dispose();
			outlineMaterial.dispose();
		},
	};
}

export function createTunnelShell(
	scene: Scene,
	name: string,
	template: TunnelTemplate,
	depthM: number,
): Mesh {
	const inner: Vector3[] = [];
	const outer: Vector3[] = [];
	const wallM = template.sectionHeightM * TUNNEL_ARCH_WALL_RATIO;
	const circular = template.shape === "circular";
	const count = TUNNEL_ARC_SEGMENTS_COUNT;
	for (let segment = 0; segment <= count; segment++) {
		const angleRad = (segment / count) * Math.PI * (circular ? 2 : 1);
		const centerM = circular ? template.sectionHeightM * HALF_RATIO : wallM;
		const radiusY = circular
			? template.sectionHeightM * HALF_RATIO
			: template.sectionHeightM - wallM;
		inner.push(
			new Vector3(
				Math.cos(angleRad) * template.sectionWidthM * HALF_RATIO,
				centerM + Math.sin(angleRad) * radiusY,
				0,
			),
		);
		outer.push(
			new Vector3(
				Math.cos(angleRad) *
					(template.sectionWidthM * HALF_RATIO + TUNNEL_LINING_M),
				centerM + Math.sin(angleRad) * (radiusY + TUNNEL_LINING_M),
				0,
			),
		);
	}
	if (!circular) {
		inner.unshift(new Vector3(template.sectionWidthM * HALF_RATIO, 0, 0));
		outer.unshift(
			new Vector3(
				template.sectionWidthM * HALF_RATIO + TUNNEL_LINING_M,
				-TUNNEL_LINING_M,
				0,
			),
		);
		inner.push(new Vector3(-template.sectionWidthM * HALF_RATIO, 0, 0));
		outer.push(
			new Vector3(
				-template.sectionWidthM * HALF_RATIO - TUNNEL_LINING_M,
				-TUNNEL_LINING_M,
				0,
			),
		);
		inner.push(inner[0]?.clone() ?? Vector3.Zero());
		outer.push(outer[0]?.clone() ?? Vector3.Zero());
	}
	const paths = [
		inner,
		outer,
		outer.map((point) => new Vector3(point.x, point.y, depthM)),
		inner.map((point) => new Vector3(point.x, point.y, depthM)),
		inner,
	];
	return MeshBuilder.CreateRibbon(
		name,
		{ pathArray: paths, sideOrientation: Mesh.DOUBLESIDE },
		scene,
	);
}

export interface RoadMeshes {
	surface: Mesh;
	markings: Mesh[];
}

export function createRoadMesh(
	scene: Scene,
	structure: PlacedStructure,
	terrain: StructureTerrain,
): RoadMeshes {
	const surface = new Mesh("bypass-road", scene);
	const markings: Mesh[] = [];
	const template = structure.template;
	if (template.kind !== "bypass") return { surface, markings };
	const anchor = terrain.toLocal(structure.anchor);
	const positions: number[] = [];
	const indices: number[] = [];
	const normals: number[] = [];
	const widthM = bypassWidthM(template);
	const samples: Vector3[] = [];
	for (let pointIndex = 1; pointIndex < template.points.length; pointIndex++) {
		const start = template.points[pointIndex - 1];
		const end = template.points[pointIndex];
		if (!start || !end) continue;
		const steps = Math.max(
			1,
			Math.ceil(
				Math.hypot(end.x - start.x, end.z - start.z) / ROAD_SAMPLE_SPACING_M,
			),
		);
		for (let step = pointIndex === 1 ? 0 : 1; step <= steps; step++)
			samples.push(
				new Vector3(
					start.x + ((end.x - start.x) * step) / steps,
					0,
					start.z + ((end.z - start.z) * step) / steps,
				),
			);
	}
	const across: Vector3[] = [];
	let previousLoaded = false;
	for (const [sampleIndex, sample] of samples.entries()) {
		const previous = samples[Math.max(0, sampleIndex - 1)] ?? sample;
		const next =
			samples[Math.min(samples.length - 1, sampleIndex + 1)] ?? sample;
		const normal = new Vector3(
			-(next.z - previous.z),
			0,
			next.x - previous.x,
		).normalize();
		across.push(normal);
		let loaded =
			terrain.heightAt({ x: sample.x + anchor.x, z: sample.z + anchor.z }) !==
			null;
		const vertexIndex = positions.length / 3;
		for (const side of [-1, 1]) {
			const eastM = sample.x + normal.x * widthM * HALF_RATIO * side;
			const southM = sample.z + normal.z * widthM * HALF_RATIO * side;
			const heightM = terrain.heightAt({
				x: eastM + anchor.x,
				z: southM + anchor.z,
			});
			loaded = loaded && heightM !== null;
			positions.push(
				eastM,
				(heightM ?? structure.anchor.elevationM) -
					structure.anchor.elevationM +
					ROAD_LIFT_M,
				southM,
			);
		}
		if (loaded && previousLoaded)
			indices.push(
				vertexIndex - 2,
				vertexIndex,
				vertexIndex - 1,
				vertexIndex - 1,
				vertexIndex,
				vertexIndex + 1,
			);
		previousLoaded = loaded;
	}
	for (
		let laneIndex = 1;
		laneIndex < Math.max(2, template.laneCount);
		laneIndex++
	) {
		const laneOffsetM =
			template.laneCount === 1
				? 0
				: (laneIndex - template.laneCount * HALF_RATIO) * template.laneWidthM;
		let travelledM = 0;
		for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex++) {
			const previous = samples[sampleIndex - 1];
			const next = samples[sampleIndex];
			const previousAcross = across[sampleIndex - 1];
			const nextAcross = across[sampleIndex];
			if (!previous || !next || !previousAcross || !nextAcross) continue;
			const lengthM = Vector3.Distance(previous, next);
			if (lengthM < MIN_GEOMETRY_LENGTH_M) continue;
			let distanceM = 0;
			while (distanceM < lengthM) {
				const phaseM = (travelledM + distanceM) % (ROAD_DASH_M + ROAD_GAP_M);
				const marked = phaseM < ROAD_DASH_M;
				const endM = Math.min(
					lengthM,
					distanceM +
						Math.max(
							MIN_GEOMETRY_LENGTH_M,
							(marked ? ROAD_DASH_M : ROAD_DASH_M + ROAD_GAP_M) - phaseM,
						),
				);
				if (marked) {
					const dash: Vector3[] = [];
					for (const endpointM of [distanceM, endM]) {
						const fraction = endpointM / lengthM;
						const eastM =
							previous.x +
							(next.x - previous.x) * fraction +
							(previousAcross.x +
								(nextAcross.x - previousAcross.x) * fraction) *
								laneOffsetM;
						const southM =
							previous.z +
							(next.z - previous.z) * fraction +
							(previousAcross.z +
								(nextAcross.z - previousAcross.z) * fraction) *
								laneOffsetM;
						const heightM = terrain.heightAt({
							x: eastM + anchor.x,
							z: southM + anchor.z,
						});
						if (heightM !== null)
							dash.push(
								new Vector3(
									eastM,
									heightM -
										structure.anchor.elevationM +
										ROAD_LIFT_M +
										ROAD_MARKING_LIFT_M,
									southM,
								),
							);
					}
					if (dash.length === 2)
						markings.push(
							MeshBuilder.CreateTube(
								"lane-marking",
								{
									path: dash,
									radius: ROAD_MARKING_WIDTH_M * HALF_RATIO,
									tessellation: MARKING_SEGMENTS_COUNT,
								},
								scene,
							),
						);
				}
				distanceM = endM;
			}
			travelledM += lengthM;
		}
	}
	VertexData.ComputeNormals(positions, indices, normals);
	const data = new VertexData();
	data.positions = positions;
	data.indices = indices;
	data.normals = normals;
	data.applyToMesh(surface);
	return { surface, markings };
}
