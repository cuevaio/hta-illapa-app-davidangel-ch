import { Color3, Mesh, StandardMaterial, TransformNode, Vector3, VertexData, type Camera, type Scene } from '@babylonjs/core';
import type { Terrain } from '../scenario/terrain';
import { LodTerrain, viewOf } from './lod/LodTerrain';
import type { LodProfile } from './lod/lodProfile';
import { CONTEXT_SCALE, contextFrame, contextLook, contextNodePosition, contextSseScale, patchHole, type MapSite } from './mapContext';
import type { TilesClient } from './tilesClient';
import type { ImagerySource } from './imagery/imagerySource';
import { localToWorld } from './lod/quadtree';
import { viewFocus } from './weather/region';
import type { WeatherGpu } from './weather/WeatherGpu';

/** The seam curtain hangs this far below the patch's lowest cell (m). */
const CURTAIN_DEPTH = 300;

/**
 * The real relief around a "Simular aquí" simulation (S1): the streamed Peru LOD
 * (LodTerrain, same engine and profile as the overview) drawn in the simulator scene under
 * the terrain root, at ×1, with a hole where the simulated patch is. A curtain along the
 * patch edge closes the gaps the coarser context mesh leaves at the seam. Hidden in XR.
 * With Satélite (S7) the context drapes the provider imagery (CONTEXT shader variant) and
 * refines past z11 for it, exactly as the overview. With the weather layers (S8) the context
 * tiles drape them too (clouds draped instead of the overview's raised sheet).
 */
export class MapContextView {
  private readonly node: TransformNode;
  private terrain: LodTerrain | null = null;
  private site: MapSite | null = null;
  private curtain: Mesh | null = null;
  private readonly curtainMaterial: StandardMaterial;
  private failed = false;
  private imagery: ImagerySource | null = null;

  constructor(
    private readonly scene: Scene,
    root: TransformNode,
    private readonly client: TilesClient,
    private readonly profile: LodProfile,
    private readonly weather: WeatherGpu | null = null,
  ) {
    this.node = new TransformNode('map-context', scene);
    this.node.parent = root;
    this.node.scaling.setAll(CONTEXT_SCALE);
    this.curtainMaterial = new StandardMaterial('map-context-curtain', scene);
    this.curtainMaterial.diffuseColor = new Color3(0.45, 0.4, 0.33);
    this.curtainMaterial.specularColor = Color3.Black();
    this.curtainMaterial.backFaceCulling = false;
  }

  /** True while a real-location context is shown. */
  get active(): boolean {
    return this.terrain !== null;
  }

  /** The context failed to load its base tiles (the simulation is unaffected). */
  get unavailable(): boolean {
    return this.failed;
  }

  /** Shows the relief around `site` for the simulator terrain, or nothing ("sin contexto"). */
  set(site: MapSite | null, terrain: Terrain): void {
    if (!site) {
      this.clear();
      return;
    }
    if (!this.site || this.site.lon !== site.lon || this.site.lat !== site.lat) {
      this.clear();
      this.site = { ...site };
      this.failed = false;
      this.terrain = new LodTerrain(this.scene, this.client, this.profile, contextFrame(site), contextLook(), { parent: this.node }, this.weather?.binding(this.scene, 'drape') ?? null);
      this.terrain.setImagery(this.imagery);
      this.terrain.ready.catch((err: unknown) => {
        console.warn('Map context unavailable:', err);
        this.failed = true;
      });
    }
    // A resolution change keeps the site and the extent, but not the cell centres.
    this.node.position.set(...contextNodePosition(terrain.size));
    this.terrain!.setHole(patchHole(terrain));
    this.buildCurtain(terrain);
  }

  /** Satélite (a provider) or Relieve (null); kept for the next site too. */
  setImagery(source: ImagerySource | null): void {
    this.imagery = source;
    this.terrain?.setImagery(source);
  }

  clear(): void {
    this.terrain?.dispose();
    this.terrain = null;
    this.site = null;
    this.curtain?.dispose();
    this.curtain = null;
  }

  /**
   * Once per simulator frame, before scene.render(). `simulating`: coarser LOD while the flow
   * runs; `inXr`: the context is hidden and stops streaming (XR unchanged).
   */
  update(camera: Camera, pixelHeight: number, opts: { simulating: boolean; inXr: boolean }): void {
    if (!this.terrain) return;
    this.node.setEnabled(!opts.inXr);
    this.curtain?.setEnabled(!opts.inXr);
    if (opts.inXr) return;
    this.terrain.setSseScale(contextSseScale(opts.simulating));
    const now = performance.now();
    if (this.weather && this.site) this.weather.update(now, this.weatherFocus(camera));
    this.terrain.update(now, viewOf(camera, pixelHeight, this.node.computeWorldMatrix(true)));
  }

  /** Overlay footprint of the simulator camera, in context km → Web Mercator unit square. */
  private weatherFocus(camera: Camera) {
    const inv = this.node.computeWorldMatrix(true).clone().invert();
    const eye = Vector3.TransformCoordinates(camera.globalPosition, inv);
    const dir = Vector3.TransformNormal(camera.getDirection(Vector3.Forward()), inv);
    const frame = contextFrame(this.site!);
    const f = viewFocus([eye.x, eye.y, eye.z], [dir.x, dir.y, dir.z], this.terrain?.heightKm(eye.x, eye.z) ?? 0);
    const [x, y] = localToWorld(frame, f.x, f.z);
    return { x, y, side: f.sideKm / frame.k };
  }

  /** Debug/verification hook (window.__app.mapContextStats()). */
  stats() {
    return this.terrain ? { ...this.terrain.stats, site: this.site, unavailable: this.failed } : null;
  }

  dispose(): void {
    this.clear();
    this.curtainMaterial.dispose();
    this.node.dispose();
  }

  /** Vertical strip along the patch boundary (cell centres), from each edge cell down. */
  private buildCurtain(t: Terrain): void {
    this.curtain?.dispose();
    const n = t.resolution;
    const dx = t.cellSize;
    const bottom = t.minMax()[0] - CURTAIN_DEPTH;
    const ring: [number, number][] = [];
    for (let i = 0; i < n - 1; i++) ring.push([i, 0]);
    for (let j = 0; j < n - 1; j++) ring.push([n - 1, j]);
    for (let i = n - 1; i > 0; i--) ring.push([i, n - 1]);
    for (let j = n - 1; j > 0; j--) ring.push([0, j]);
    ring.push(ring[0]);
    const positions: number[] = [];
    const indices: number[] = [];
    ring.forEach(([i, j], k) => {
      const x = (i + 0.5) * dx;
      const z = (j + 0.5) * dx;
      positions.push(x, t.effective[j * n + i], z, x, bottom, z);
      if (k > 0) {
        const a = 2 * (k - 1);
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    data.normals = normals;
    const mesh = new Mesh('map-context-curtain', this.scene);
    data.applyToMesh(mesh);
    mesh.parent = this.node.parent;
    mesh.material = this.curtainMaterial;
    mesh.isPickable = false;
    this.curtain = mesh;
  }
}
