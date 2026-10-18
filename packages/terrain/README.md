# Terrain

Framework-agnostic Three.js terrain for the ILLAPA editor and Quest tabletop model. Hosts own the renderer, camera, controls and frame loop.

```ts
import { createTerrain, TERRAIN_ATTRIBUTION } from "@hack-the-andes-project/terrain";

const terrain = createTerrain({
  renderer,
  origin: { lat: -13.163, lng: -72.545 },
  onTilesLoaded: invalidate,
});
scene.add(terrain.group);
terrain.update(camera);
```

`group` can be translated, rotated and scaled by its parent, including a 1:1000 AR model. Coordinates are local metres from `origin`: +x east, +y up, −z north. Heights are true elevations, including negative values, with no exaggeration. The horizontal frame uses Web Mercator scaled by the cosine of the origin latitude, so distances are accurate near the origin.

- `update(camera)`: run before each host-rendered frame; selects and streams tiles, advances geomorph and imagery transitions. WebXR `ArrayCamera` uses the array's world position and first eye projection. Perspective and orthographic cameras are supported.
- `heightAt({ x, z })`: bilinear elevation from the finest cached tile; `null` without coverage.
- `pick(worldRay)`: CPU raymarch; returns a group-local `Vector3`, or `null` without a loaded intersection. Honors the clip square.
- `toLocal({ lat, lng })` / `toGeo({ x, z })`: horizontal conversions.
- `setClip({ center: { x, z }, sizeM })`: renders only that local square and refines visible tiles to zoom 15 within the working-set budget. `setClip(null)` restores unbounded SSE selection.
- `setOpacity(opacity)`: 0–1, default 1. Translucent terrain disables depth writes; 1 restores opaque rendering with depth writes enabled.
- `dispose()`: aborts requests, clears wake timers, terminates workers, disposes textures/materials/geometry and detaches the group. Does not dispose the host renderer.

Use `onTilesLoaded` to invalidate a demand frame loop. It runs on tile arrivals and requests frames while throttled updates, pending retries or short transitions need attention. Call `dispose()` when unmounting.

Requires a browser with WebGL2, module workers, `OffscreenCanvas` and `createImageBitmap`. The host must bundle the package's TypeScript source, including its worker URL (supported by Vite). Uses shared skirted geometry, R16F height textures, bounded LRU caches and a 300-tile LOD working set. Elevation request failures remain uncached and retry; imagery falls back to a neutral surface after repeated failures. CPU heights match texture interpolation; mesh triangulation and geomorph can differ slightly.

Logarithmic depth is optional: the material includes Three.js depth chunks and works with either renderer setting. For editor views around 50 m–30 km, use an appropriate near/far range; logarithmic depth can improve precision for wider ranges. The material uses local-space relief lighting and respects parent transforms.

Display `TERRAIN_ATTRIBUTION` in the host UI: Elevation: Tilezen Joerd / AWS Terrain Tiles (Mapzen and data providers). Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community. Elevation streams Terrarium PNG tiles from AWS (maximum zoom 15); imagery streams Esri World Imagery.
