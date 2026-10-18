import {
	Color3,
	type Mesh,
	MeshBuilder,
	type Scene,
	StandardMaterial,
	type TransformNode,
	Vector3,
} from "@babylonjs/core";
import type {
	SourceCommand,
	Vec2,
	WallCommand,
	WallMaterial,
} from "../edit/commands";
import type { EditPreview } from "../edit/tools";
import { concreteWallMesh } from "./barrierMesh";

const OK = new Color3(1, 0.6, 0.15);
const BLOCKED = new Color3(0.95, 0.1, 0.1);

/** Semi-transparent ghosts of the wall / source under the pointer, in terrain-local space. */
export class EditPreviewView implements EditPreview {
	private wallMesh: Mesh | null = null;
	private highlightMesh: Mesh | null = null;
	private readonly sourceMesh: Mesh;
	private readonly wallMat: StandardMaterial;
	private readonly highlightMat: StandardMaterial;

	constructor(
		private readonly scene: Scene,
		private readonly root: TransformNode,
		private readonly heightAt: (x: number, z: number) => number,
		private readonly cellSize: () => number,
	) {
		this.wallMat = this.material("ghost-wall", OK, 0.55);
		this.highlightMat = this.material("ghost-erase", BLOCKED, 0.6);
		this.sourceMesh = MeshBuilder.CreateCylinder(
			"ghost-source",
			{ height: 1, diameter: 2, tessellation: 32 },
			scene,
		);
		this.sourceMesh.material = this.material("ghost-source", OK, 0.4);
		this.sourceMesh.parent = root;
		this.sourceMesh.isPickable = false;
		this.sourceMesh.setEnabled(false);
	}

	private material(
		name: string,
		color: Color3,
		alpha: number,
	): StandardMaterial {
		const m = new StandardMaterial(name, this.scene);
		m.diffuseColor = color;
		m.emissiveColor = color.scale(0.6);
		m.alpha = alpha;
		m.backFaceCulling = false;
		m.twoSidedLighting = true;
		return m;
	}

	/** A tube resting on the terrain along the polyline (densified so it follows the ground). */
	private tube(
		name: string,
		points: Vec2[],
		halfWidth: number,
		height: number,
		mat: StandardMaterial,
	): Mesh {
		const radius = Math.max(Math.min(height / 2, halfWidth), 0.5);
		const path: Vector3[] = [];
		const pts =
			points.length === 1
				? [points[0], [points[0][0] + 0.01, points[0][1]] as Vec2]
				: points;
		for (let s = 0; s + 1 < pts.length; s++) {
			const [ax, az] = pts[s];
			const [bx, bz] = pts[s + 1];
			const steps = Math.max(
				1,
				Math.ceil(Math.hypot(bx - ax, bz - az) / (halfWidth * 0.5)),
			);
			for (let k = 0; k <= steps; k++) {
				if (s > 0 && k === 0) continue;
				const x = ax + ((bx - ax) * k) / steps;
				const z = az + ((bz - az) * k) / steps;
				path.push(new Vector3(x, this.heightAt(x, z) + radius, z));
			}
		}
		const mesh = MeshBuilder.CreateTube(
			name,
			{ path, radius, tessellation: 12, cap: 3 },
			this.scene,
		);
		mesh.material = mat;
		mesh.parent = this.root;
		mesh.isPickable = false;
		return mesh;
	}

	/** Concrete walls preview as their block, earth berms as a tube resting on the ground. */
	private ghost(
		name: string,
		w: Pick<WallCommand, "points" | "halfWidth" | "height" | "material">,
		mat: StandardMaterial,
	): Mesh {
		if (w.material !== "concrete")
			return this.tube(name, w.points, w.halfWidth, w.height, mat);
		const mesh = concreteWallMesh(
			name,
			w,
			this.cellSize(),
			this.heightAt,
			this.scene,
		);
		mesh.material = mat;
		mesh.parent = this.root;
		return mesh;
	}

	wall(
		points: Vec2[] | null,
		halfWidth: number,
		height: number,
		material: WallMaterial,
		blocked: boolean,
	): void {
		this.wallMesh?.dispose();
		this.wallMesh = null;
		if (!points || points.length === 0) return;
		const color = blocked ? BLOCKED : OK;
		this.wallMat.diffuseColor = color;
		this.wallMat.emissiveColor = color.scale(0.6);
		this.wallMesh = this.ghost(
			"ghost-wall",
			{ points, halfWidth, height, material },
			this.wallMat,
		);
	}

	source(pos: Vec2 | null, radius: number): void {
		this.sourceMesh.setEnabled(pos !== null);
		if (!pos) return;
		const height = Math.max(radius * 0.6, 10);
		this.sourceMesh.scaling.set(radius, height, radius);
		this.sourceMesh.position.set(
			pos[0],
			this.heightAt(pos[0], pos[1]) + height / 2,
			pos[1],
		);
	}

	highlight(target: WallCommand | SourceCommand | null): void {
		this.highlightMesh?.dispose();
		this.highlightMesh = null;
		if (target?.type === "wall")
			this.highlightMesh = this.ghost(
				"ghost-erase",
				{ ...target, height: target.height + 2 },
				this.highlightMat,
			);
		else if (target?.type === "source") {
			const r = target.radius * 1.15;
			const height = Math.max(r * 0.8, 12);
			const mesh = MeshBuilder.CreateCylinder(
				"ghost-erase-source",
				{ height: 1, diameter: 2, tessellation: 32 },
				this.scene,
			);
			mesh.scaling.set(r, height, r);
			mesh.position.set(
				target.pos[0],
				this.heightAt(target.pos[0], target.pos[1]) + height / 2,
				target.pos[1],
			);
			mesh.material = this.highlightMat;
			mesh.parent = this.root;
			mesh.isPickable = false;
			this.highlightMesh = mesh;
		}
	}

	clear(): void {
		this.wall(null, 0, 0, "earth", false);
		this.source(null, 0);
		this.highlight(null);
	}
}
