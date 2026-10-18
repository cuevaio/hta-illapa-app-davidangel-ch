import { NullEngine, Ray, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import { afterEach, describe, expect, it } from 'vitest';
import { TilesClient } from '../../src/map/tilesClient';
import type { HeightGrid } from '../../src/scenario/terrain';
import { SiteTerrain } from '../../src/viewer/SiteTerrain';

const ORIGIN = { lat: -12.05, lng: -77.04 };
const RESOLUTION = 64;
const CELL_M = 10;
const HALF_M = (RESOLUTION * CELL_M) / 2;

/** Elevation = 1000 m + metres north of the site (row j of a local grid grows northwards). */
function northSlope(): HeightGrid {
  const heights = new Float32Array(RESOLUTION * RESOLUTION);
  for (let j = 0; j < RESOLUTION; j++) for (let i = 0; i < RESOLUTION; i++) heights[j * RESOLUTION + i] = 1000 + (j + 0.5) * CELL_M - HALF_M;
  return { resolution: RESOLUTION, cellSize: CELL_M, heights };
}

let engine: NullEngine;

function setup() {
  engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  return { scene, terrain: new SiteTerrain({ scene, origin: ORIGIN }) };
}

const enabledTerrainMeshes = (terrain: SiteTerrain) => terrain.root.getChildMeshes().filter((mesh) => mesh.isEnabled());

describe('site terrain (right-handed local metres: +x east, +y up, -z north)', () => {
  afterEach(() => engine.dispose());

  it('converts geographic points: north is -z, east is +x, and back', () => {
    const { terrain } = setup();
    expect(terrain.toLocal(ORIGIN)).toEqual({ x: 0, z: 0 });
    const north = terrain.toLocal({ lat: ORIGIN.lat + 0.01, lng: ORIGIN.lng });
    expect(north.x).toBeCloseTo(0, 6);
    expect(north.z).toBeCloseTo(-1112, -1);
    const east = terrain.toLocal({ lat: ORIGIN.lat, lng: ORIGIN.lng + 0.01 });
    expect(east.x).toBeCloseTo(1088, -1);
    expect(east.z).toBeCloseTo(0, 6);
    const back = terrain.toGeo({ x: 250, z: -400 });
    const again = terrain.toLocal(back);
    expect(again.x).toBeCloseTo(250, 6);
    expect(again.z).toBeCloseTo(-400, 6);
  });

  it('answers heights only inside a loaded patch, with north at -z', () => {
    const { terrain } = setup();
    expect(terrain.heightAt({ x: 0, z: 0 })).toBeNull();
    terrain.setGrid(northSlope());
    expect(terrain.heightAt({ x: 0, z: 0 })).toBeCloseTo(1000, 3);
    expect(terrain.heightAt({ x: 40, z: -100 })).toBeCloseTo(1100, 3);
    expect(terrain.heightAt({ x: 0, z: 100 })).toBeCloseTo(900, 3);
    expect(terrain.heightAt({ x: HALF_M + 1, z: 0 })).toBeNull();
    expect(terrain.heightAt({ x: 0, z: -HALF_M - 1 })).toBeNull();
  });

  it('picks the relief along a world ray, returning root-local metres', () => {
    const { terrain } = setup();
    terrain.setGrid(northSlope());
    const hit = terrain.pick(new Ray(new Vector3(50, 5000, -100), new Vector3(0, -1, 0)));
    expect(hit?.x).toBeCloseTo(50, 3);
    expect(hit?.y).toBeCloseTo(1100, 1);
    expect(hit?.z).toBeCloseTo(-100, 3);
    expect(terrain.pick(new Ray(new Vector3(50, 5000, -100), new Vector3(0, 1, 0)))).toBeNull();
  });

  it('picks through a scaled and moved parent (XR maquette table)', () => {
    const { scene, terrain } = setup();
    terrain.setGrid(northSlope());
    const table = new TransformNode('table', scene);
    table.position.set(1, 0.8, -2);
    table.scaling.setAll(1 / 1000);
    terrain.root.parent = table;
    const above = Vector3.TransformCoordinates(new Vector3(50, 5000, -100), table.computeWorldMatrix(true));
    const hit = terrain.pick(new Ray(above, new Vector3(0, -1, 0)));
    expect(hit?.x).toBeCloseTo(50, 1);
    expect(hit?.y).toBeCloseTo(1100, 0);
    expect(hit?.z).toBeCloseTo(-100, 1);
  });

  it('clips the drawn relief to a square around a point and restores it', () => {
    const { terrain } = setup();
    terrain.setGrid(northSlope());
    const span = () => {
      const meshes = enabledTerrainMeshes(terrain);
      const { min, max } = meshes.reduce(
        (box, mesh) => {
          const bounds = mesh.getHierarchyBoundingVectors(true);
          return { min: Vector3.Minimize(box.min, bounds.min), max: Vector3.Maximize(box.max, bounds.max) };
        },
        { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) },
      );
      return { x: max.x - min.x, z: max.z - min.z, centreZ: (max.z + min.z) / 2 };
    };
    expect(span().x).toBeGreaterThan(RESOLUTION * CELL_M * 0.9);
    terrain.setClip({ center: { x: 0, z: -100 }, sizeM: 200 });
    expect(span().x).toBeCloseTo(200, -1);
    expect(span().centreZ).toBeCloseTo(-100, -1);
    expect(terrain.heightAt({ x: 250, z: 0 })).toBeCloseTo(1000, 3);
    terrain.setClip(null);
    expect(span().x).toBeGreaterThan(RESOLUTION * CELL_M * 0.9);
  });

  it('fades every drawn mesh with the opacity', () => {
    const { terrain } = setup();
    terrain.setGrid(northSlope());
    terrain.setOpacity(0.4);
    expect(enabledTerrainMeshes(terrain).every((mesh) => mesh.visibility === 0.4)).toBe(true);
  });

  it('loads the real relief around the site from the tiles backend', async () => {
    engine = new NullEngine();
    const scene = new Scene(engine);
    // Terrarium RGB (128, 10, 0) decodes to 10 m.
    const tiles = new TilesClient('/tiles-api', async () => new Response(new Uint8Array([1]), { status: 200 }), async () => ({ width: 1, height: 1, rgba: new Uint8Array([128, 10, 0, 255]) }));
    let loaded = 0;
    const terrain = new SiteTerrain({ scene, origin: ORIGIN, resolution: 16, onLoaded: () => loaded++ }, tiles);
    await terrain.load();
    expect(loaded).toBe(1);
    expect(terrain.heightAt({ x: 0, z: 0 })).toBeCloseTo(10, 3);
  });
});
