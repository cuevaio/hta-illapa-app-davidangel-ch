# Terrain

Imperative Babylon.js terrain for the ILLAPA editor and Quest tabletop model. The host owns the engine, scene, camera, controls and render loop.

```ts
import { TransformNode } from "@babylonjs/core";
import {
  createBabylonTerrain,
  TERRAIN_ATTRIBUTION,
} from "@hack-the-andes-project/terrain/babylon/terrain";

scene.useRightHandedSystem = true;
const content = new TransformNode("world", scene);
const terrain = createBabylonTerrain({
  scene,
  origin: { lat: -11.84, lng: -76.39 },
});
terrain.root.parent = content;
const observer = scene.onBeforeRenderObservable.add(() => {
  if (scene.activeCamera) terrain.update(scene.activeCamera);
});
```

The package root also exports `createBabylonTerrain`, `TERRAIN_ATTRIBUTION`, `BabylonTerrain` and `BabylonTerrainOptions`. Neutral geographic types (`GeoPoint`, `LocalPoint`, `TerrainClip`) live in `src/types.ts` and are available from the package root or `/types`.

Set `scene.useRightHandedSystem = true` before creating terrain or camera resources. Coordinates are local metres from `origin`: +x east, +y up, −z north. Heights are true elevations, including negative values, with no exaggeration. The horizontal frame uses Web Mercator scaled by the cosine of the origin latitude, so distances are accurate near the origin.

`root` is a Babylon `TransformNode`. Its parent can translate, rotate and scale the terrain alongside structures, including an AR tabletop model. Sampling and coordinate conversions stay in the original local metric frame.

- `update(camera)`: call before every rendered frame to select and stream tiles and advance geomorph and imagery transitions. Supports perspective and orthographic cameras; XR uses the rig camera's world position and first eye projection.
- `heightAt({ x, z })`: bilinear elevation from the finest cached tile; returns `null` without coverage.
- `pick(worldRay)`: accepts a Babylon `Ray` in world coordinates and returns a terrain-local Babylon `Vector3`, or `null` without a loaded intersection. Applies parent transforms and honors the clip square.
- `toLocal({ lat, lng })` / `toGeo({ x, z })`: horizontal conversions.
- `setClip({ center: { x, z }, sizeM })`: renders only that local square and refines visible tiles to zoom 15 within the working-set budget. `setClip(null)` restores unbounded screen-space-error selection.
- `setOpacity(opacity)`: 0–1, default 1. Translucent terrain disables depth writes; 1 restores opaque rendering with depth writes enabled.
- `dispose()`: aborts requests, clears wake timers, terminates workers, disposes terrain textures/materials/meshes and detaches the root. Does not dispose the host scene or engine.

The optional `onTilesLoaded` callback runs on tile arrivals and requests frames while throttled updates, pending retries or short transitions need attention. A host using a demand render loop can use it to request another frame. Keep calling `update` on those frames.

Remove the frame observer and dispose the terrain when the host unmounts:

```ts
scene.onBeforeRenderObservable.remove(observer);
terrain.dispose();
```

Requires a browser with WebGL2, module workers, `OffscreenCanvas` and `createImageBitmap`. The host must bundle the package's TypeScript source, including its worker URL (supported by Vite). Rendering uses shared skirted geometry, half-float elevation data, bounded LRU caches and a 300-tile LOD working set. Elevation request failures remain uncached and retry; imagery falls back to the nearest cached ancestor after repeated failures, using a neutral surface only without ancestor coverage. CPU heights match texture interpolation; mesh triangulation and geomorph can differ slightly.

For editor views around 50 m–30 km, scale the camera's `minZ` and `maxZ` with its viewing distance to preserve depth precision. The terrain material uses local-space relief lighting and respects parent transforms.

Display `TERRAIN_ATTRIBUTION` in the host UI: Elevation: Tilezen Joerd / AWS Terrain Tiles (Mapzen and data providers). Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community. Elevation streams Terrarium PNG tiles from AWS (maximum zoom 15); imagery streams Esri World Imagery through zoom 17. Deeper imagery tiles reuse their cached zoom-15 elevation ancestor through a UV subrectangle; elevation requests and CPU height sampling stay capped at zoom 15, with unchanged cache and working-set budgets.
