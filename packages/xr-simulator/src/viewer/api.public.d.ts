/**
 * Public types of the viewer entry (`@hack-the-andes-project/xr-simulator/viewer`). Host apps
 * type-check against this file only, never against the simulator sources and their compiler
 * settings; tests/viewer/publicApi.test.ts keeps it in line with src/viewer/api.ts.
 */
import type { AbstractEngine, Camera, Ray, Scene, TransformNode, Vector3, WebXRExperienceHelper, WebXRInput } from '@babylonjs/core';

/** 'overview' or the id of the mode on screen. */
export type ViewerScreen = string;
export type ImageryMode = 'relief' | 'satellite';
/** A satellite imagery provider, handed as is from the viewer to a site terrain. */
export type ImagerySource = object;

export interface PickedPoint {
  lon: number;
  lat: number;
  height: number | null;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface LocalPoint {
  x: number;
  z: number;
}

export interface SiteClip {
  center: LocalPoint;
  sizeM: number;
}

export interface SiteTerrainOptions {
  scene: Scene;
  origin: GeoPoint;
  resolution?: number;
  onLoaded?(): void;
}

/** Real relief around a site in a right-handed local metric frame: +x east, +y up, -z north. */
export interface SiteTerrain {
  readonly root: TransformNode;
  load(): Promise<void>;
  heightAt(point: LocalPoint): number | null;
  pick(worldRay: Ray): Vector3 | null;
  toLocal(point: GeoPoint): LocalPoint;
  toGeo(point: LocalPoint): GeoPoint;
  setClip(clip: SiteClip | null): void;
  setOpacity(opacity: number): void;
  setImagery(source: ImagerySource | null): void;
  update(camera: Camera): void;
  dispose(): void;
}

export interface XrSessionMember {
  readonly baseExperience: WebXRExperienceHelper;
  readonly input: WebXRInput;
}

export interface ModeXr {
  readonly member: XrSessionMember;
  enter(mode: XRSessionMode): Promise<void>;
  pause(): void;
  resume(): void;
}

export interface ModeVr {
  started(xr: ModeXr, mode: XRSessionMode): Promise<void>;
  backToMap(xr: ModeXr): Promise<void>;
}

export interface ModeHost {
  readonly engine: AbstractEngine;
  readonly canvas: HTMLCanvasElement;
  readonly container: HTMLElement;
  readonly webgpu: boolean;
  readonly vr: ModeVr;
  overviewActive(): boolean;
  showOverview(fromVr?: boolean): void;
  showMode(modeId: string): void;
  createSiteTerrain(options: SiteTerrainOptions): SiteTerrain;
}

export interface SimulatorMode {
  readonly id: string;
  readonly entryLabel: string | null;
  start(): Promise<void>;
  open(point: PickedPoint | null): Promise<void>;
  show(): void;
  hide(): void;
  frame(): void;
  presenting(): boolean;
  handleKey(event: KeyboardEvent): void;
  notify(message: string | null): void;
  imageryChanged(mode: ImageryMode, source: ImagerySource | null): void;
  imageryAttribution(text: string): void;
  dispose(): void;
}

export type SimulatorModeFactory = (host: ModeHost) => SimulatorMode;

export interface CreateXrViewerOptions {
  tilesBaseUrl?: string;
  weatherBaseUrl?: string;
  credentials?: RequestCredentials;
  modes?: SimulatorModeFactory[];
  initialMode?: string;
  onScreenChange?(screen: ViewerScreen): void;
}

export interface XrViewerHandle {
  readonly ready: Promise<void>;
  activeScreen(): ViewerScreen | null;
  mode(id: string): SimulatorMode | undefined;
  showOverview(): void;
  openMode(id: string): Promise<void>;
  dispose(): void;
}

export declare function createXrViewer(container: HTMLElement, options?: CreateXrViewerOptions): XrViewerHandle;
export declare const TERRAIN_ATTRIBUTION: string;
