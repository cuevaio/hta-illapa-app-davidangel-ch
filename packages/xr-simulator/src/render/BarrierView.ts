import { Color3, StandardMaterial, type Mesh, type Scene, type TransformNode } from '@babylonjs/core';
import type { WallCommand } from '../edit/commands';
import type { Terrain } from '../scenario/terrain';
import { concreteWallMesh } from './barrierMesh';

/**
 * Draws concrete walls as blocks over the terrain. Earth berms need no mesh: they are part of
 * the terrain surface, which TerrainView tints as compacted earth.
 */
export class BarrierView {
  private meshes: Mesh[] = [];
  private readonly material: StandardMaterial;

  constructor(private readonly scene: Scene, private readonly root: TransformNode) {
    this.material = new StandardMaterial('concrete', scene);
    this.material.diffuseColor = new Color3(0.68, 0.68, 0.66);
    this.material.specularColor = new Color3(0.08, 0.08, 0.08);
    this.material.backFaceCulling = false;
    this.material.twoSidedLighting = true;
  }

  update(walls: WallCommand[], terrain: Terrain): void {
    for (const m of this.meshes) m.dispose();
    this.meshes = walls
      .filter((w) => w.material === 'concrete')
      .map((w) => {
        const mesh = concreteWallMesh(`concrete-${w.id}`, w, terrain.cellSize, (x, z) => terrain.baseHeightAt(x, z), this.scene);
        mesh.material = this.material;
        mesh.parent = this.root;
        return mesh;
      });
  }
}
