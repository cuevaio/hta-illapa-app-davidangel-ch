import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, HemisphericLight, Matrix, MeshBuilder, Scene, StandardMaterial,
  TransformNode, Vector3, type AbstractEngine, type Mesh,
} from '@babylonjs/core';
import type { Ray } from '../input/pointer';
import type { Terrain } from '../scenario/terrain';

/**
 * Scene graph shared by every mode: `root` holds the terrain-local frame
 * (metres, origin at the grid corner). Web mode centres it in front of the
 * orbit camera; XR modes will re-parent/scale `root` (maquette, 1:1).
 */
export class World {
  readonly scene: Scene;
  readonly root: TransformNode;
  readonly camera: ArcRotateCamera;
  private readonly emitterMarker: Mesh;
  private readonly extraMarkers: Mesh[] = [];
  private size = 1;

  constructor(engine: AbstractEngine, canvas: HTMLCanvasElement) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0.62, 0.7, 0.78, 1);
    this.scene.ambientColor = new Color3(0.3, 0.3, 0.3);
    this.root = new TransformNode('terrain-root', this.scene);

    this.camera = new ArcRotateCamera('orbit', -2.3, 0.95, 3000, Vector3.Zero(), this.scene);
    this.camera.attachControl(canvas, true);
    this.camera.wheelDeltaPercentage = 0.02;
    this.camera.pinchDeltaPercentage = 0.004;
    this.camera.useNaturalPinchZoom = true;
    this.camera.upperBetaLimit = 1.45;
    this.camera.minZ = 1;
    this.camera.maxZ = 50_000;
    // Keyboard shortcuts belong to the app, not to camera rotation.
    this.camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');

    const hemi = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.55;
    hemi.groundColor = new Color3(0.35, 0.32, 0.28);
    const sun = new DirectionalLight('sun', new Vector3(0.5, -0.8, 0.35), this.scene);
    sun.intensity = 0.9;

    this.emitterMarker = MeshBuilder.CreateCylinder('emitter', { height: 1, diameter: 2, tessellation: 32 }, this.scene);
    const mat = new StandardMaterial('emitter-mat', this.scene);
    mat.emissiveColor = new Color3(1, 0.45, 0.1);
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.alpha = 0.45;
    this.emitterMarker.material = mat;
    this.emitterMarker.parent = this.root;
    this.emitterMarker.isPickable = false;
  }

  /**
   * With an editing tool active the left mouse button belongs to the tool, so the
   * orbit moves to the right button and panning to the middle button (or Ctrl + right).
   * Touch is unaffected: one finger orbits, pinch zooms.
   */
  setEditMode(active: boolean): void {
    this.camera._panningMouseButton = active ? 1 : 2;
  }

  /** Frames the terrain for the orbit camera. */
  fitTerrain(terrain: Terrain): void {
    const [lo, hi] = terrain.minMax();
    this.size = terrain.size;
    this.root.position.set(-terrain.size / 2, -(lo + hi) / 2, -terrain.size / 2);
    this.camera.radius = terrain.size * 1.35;
    this.camera.lowerRadiusLimit = terrain.cellSize * 4;
    this.camera.upperRadiusLimit = terrain.size * 6;
    this.camera.panningSensibility = 2000 / terrain.size;
    this.camera.setTarget(Vector3.Zero());
  }

  /** Orbit reach (src/map/mapContext.ts contextCamera): wider when the real relief surrounds the terrain. */
  setReach(r: { upperRadiusLimit: number; maxZ: number }): void {
    this.camera.upperRadiusLimit = r.upperRadiusLimit;
    this.camera.maxZ = r.maxZ;
  }

  /** One translucent cylinder per debris-flow origin. */
  placeEmitters(emitters: { position: [number, number]; radius: number; groundY: number }[], visible: boolean): void {
    while (this.extraMarkers.length < emitters.length - 1) {
      this.extraMarkers.push(this.emitterMarker.clone(`emitter-${this.extraMarkers.length + 1}`, this.root));
    }
    [this.emitterMarker, ...this.extraMarkers].forEach((m, k) => {
      const e = emitters[k];
      m.setEnabled(visible && e !== undefined);
      if (!e) return;
      const height = Math.max(e.radius * 0.6, this.size * 0.01);
      m.scaling.set(e.radius, height, e.radius);
      m.position.set(e.position[0], e.groundY + height / 2, e.position[1]);
    });
  }

  /** Converts a world-space ray into the terrain-local frame (handles any root scale). */
  toTerrainLocal(ray: Ray): Ray {
    const inv = this.root.computeWorldMatrix(true).clone().invert();
    const o = Vector3.TransformCoordinates(Vector3.FromArray(ray.origin), inv);
    const d = Vector3.TransformNormal(Vector3.FromArray(ray.direction), inv).normalize();
    return { origin: [o.x, o.y, o.z], direction: [d.x, d.y, d.z] };
  }

  /** Picking ray through a canvas pixel. */
  screenRay(x: number, y: number): Ray {
    const r = this.scene.createPickingRay(x, y, Matrix.Identity(), this.camera);
    return { origin: [r.origin.x, r.origin.y, r.origin.z], direction: [r.direction.x, r.direction.y, r.direction.z] };
  }
}
