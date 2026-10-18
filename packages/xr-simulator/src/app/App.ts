import type { AbstractEngine, WebGPUEngine } from '@babylonjs/core';
import {
  activeSources, activeWalls, distToPolyline, push, redo, targetAt, undo, wallBounds, wallProfile,
  type EditCommand, type Vec2, type WallCommand, type WallMaterial,
} from '../edit/commands';
import { EraseTool, SourceTool, WallTool, type Tool, type ToolContext } from '../edit/tools';
import { applyEditCpu, MAX_WALLS, planEdit } from '../edit/walls';
import { DomPointerSource } from '../input/DomPointerSource';
import { PointerHub, type PointerSample } from '../input/pointer';
import { raycastHeightField } from '../input/raycast';
import { probeCapabilities, summarize } from '../platform/capabilities';
import { pickLodProfile, type LodProfile } from '../map/lod/lodProfile';
import { contextBadge, contextCamera, mapSiteOf, type MapSite } from '../map/mapContext';
import { MapContextView } from '../map/MapContextView';
import { PeruOverview, type PickedPoint } from '../map/PeruOverview';
import { fetchLocalGrid, peruLabel } from '../map/peruTerrain';
import { startScreen, TilesClient } from '../map/tilesClient';
import { FpsGovernor } from '../platform/governor';
import { QUALITY_ORDER, QUALITY_PROFILES, QUEST_TARGET_FPS, type QualityProfileId } from '../platform/quality';
import { BarrierView } from '../render/BarrierView';
import { EditPreviewView } from '../render/EditPreview';
import { createEngine } from '../render/engine';
import { FlowView } from '../render/FlowView';
import { TerrainView } from '../render/TerrainView';
import { World } from '../render/World';
import { loadGeoTiff, loadPng16, type PngDemOptions } from '../scenario/dem';
import { buildScenario, decodeInlineTerrain, encodeInlineTerrain, parseScenario, serializeScenario, type Scenario } from '../scenario/scenario';
import { createSyntheticRavine, resampleGrid, SYNTHETIC_SIZE, syntheticEmitterPosition, Terrain, type HeightGrid } from '../scenario/terrain';
import { CpuSolver } from '../solver/cpu/CpuSolver';
import { MAX_EMITTERS } from '../solver/params';
import { LocalGpuSolver } from '../solver/gpu/LocalGpuSolver';
import { HttpTransport } from '../solver/remote/HttpTransport';
import { LoopbackTransport } from '../solver/remote/LoopbackTransport';
import { RemoteSolver } from '../solver/remote/RemoteSolver';
import { FramePlayer, FrameRecording, type Frame } from '../playback/FramePlayer';
import type { ResultActions } from '../playback/ResultActions';
import { resampleState } from '../solver/resample';
import type { FlowState, Solver, SolverStats } from '../solver/Solver';
import { createAppStore, newSource, sourceEmitter, type AppState, type ToolId } from '../state/appState';
import type { Store } from '../state/store';
import { ControlPanel } from '../ui/web/ControlPanel';
import { Hud, massError } from '../ui/web/Hud';
import { Toolbar } from '../ui/web/Toolbar';
import { Timeline } from '../ui/web/Timeline';
import { renderWebGpuUnavailable, renderXrCompatNotice } from '../ui/web/unsupported';
import type { OverviewXr } from '../xr/OverviewXr';
import { fetchImageryAttribution, resolveImagery, type ImageryAvailability, type ImageryEnv, type ImageryMode } from '../map/imagery/imagerySource';
import { defaultImageryMode, ImageryToggle } from '../ui/web/ImageryToggle';
import { WeatherController } from '../map/weather/WeatherController';
import { WeatherGpu, WEATHER_PROFILES } from '../map/weather/WeatherGpu';
import { cloudDecoder, httpWeatherApi } from '../map/weather/weatherApi';
import { WeatherPanel } from '../ui/web/WeatherPanel';
import type { XrController } from '../xr/XrController';
import { snapPoint } from '../xr/placement';
import type { SharedXrSession } from '../xr/sharedSession';
import { canReturnToMap, VR_OFF, vrReduce, type VrEvent, type VrState } from '../xr/vrMode';

/** Solver steps allowed per frame, per profile (before automatic degradation). */
const SUBSTEP_BUDGET: Record<QualityProfileId, number> = { low: 32, medium: 24, high: 16, ultra: 8 };
/** The CPU plan-B solver runs on the main thread: keep it small. */
const CPU_RESOLUTION = 128;
const CPU_SUBSTEP_BUDGET = 4;
const STATS_INTERVAL_MS = 250;
const TIMING_INTERVAL_MS = 2000;
/** Simulated seconds between recorded frames and the frame cap (256² ≈ 0.8 MB per frame). */
const RECORD_INTERVAL_S = 5;
const MAX_FRAMES = 240;
/** Memory budget for a recording: 240 frames at 256², about 60 at 512². */
const RECORDING_BUDGET_BYTES = 200 * 1024 * 1024;
/** While the wall tool is active, flow depth is read back this often for the placement check. */
const DEPTH_SNAPSHOT_MS = 400;

/** `site`: real location of a "Simular aquí" terrain (the map context); DEM files have none. */
type TerrainSource = { kind: 'synthetic' } | { kind: 'dem'; grid: HeightGrid; label: string; site?: MapSite & { height: number | null } };

interface Simulation {
  terrain: Terrain;
  solver: Solver;
  terrainView: TerrainView;
  flowView: FlowView;
}

/**
 * `?solver=remote` runs the remote-solver skeleton against the in-page loopback server;
 * `?solver=remote&server=https://host/api` would use the HTTP protocol (no server exists yet).
 */
const REMOTE: string | null = (() => {
  const q = new URLSearchParams(location.search);
  return q.get('solver') === 'remote' ? q.get('server') ?? 'loopback' : null;
})();

export class App {
  private engine!: AbstractEngine;
  private webgpu = false;
  private world!: World;
  private store!: Store<AppState>;
  private hud!: Hud;
  private sim!: Simulation;
  private source: TerrainSource = { kind: 'synthetic' };
  private readonly recording = new FrameRecording(MAX_FRAMES);
  private readonly player = new FramePlayer(this.recording);
  /** Live state parked while result mode replays frames. */
  private live: { state: FlowState; stats: SolverStats; resolution: number; cellSize: number } | null = null;
  private shownFrame: Frame | null = null;
  private recordPending = false;
  private lastRecordedSim = -Infinity;
  private governor!: FpsGovernor;
  private substepBudget = 16;
  private renderScale = 1;
  private statsPending = false;
  private lastStatsAt = 0;
  private lastTimingAt = 0;
  private rebuilding = false;
  private cpuStepMs: number | null = null;
  private xr: XrController | null = null;
  /** VR flight over the Peru overview; lazy-loaded like the simulator XR. */
  private overviewXr: OverviewXr | null = null;
  /** VR inside one session (S2): map (vuelo / maqueta) ↔ simulator; see src/xr/vrMode.ts. */
  private vr: VrState = VR_OFF;
  /** The immersive session shared by the map and the simulator XR (lazy, with the XR code). */
  private shared: SharedXrSession | null = null;
  private readonly renderLoop = () => this.frame();
  /** Start time of each active origin, by command id. */
  private readonly sourceStarts = new Map<string, number>();
  /** GPU sim-time extrapolation: last read time plus the sim seconds requested since that read. */
  private readonly clock = { base: 0, baseRequested: 0, requested: 0, epoch: 0 };
  private readonly pointerHub = new PointerHub();
  private webTargetFps = 60;
  /** Walls currently baked into the solver's terrain and the CPU copy. */
  private appliedWalls: WallCommand[] = [];
  private defaultEmitterPosition: Vec2 = syntheticEmitterPosition();
  private preview!: EditPreviewView;
  private barriers!: BarrierView;
  private tools!: Record<Exclude<ToolId, 'navigate'>, Tool>;
  /** Flow depth read back periodically (never per frame) for the wall placement policy. */
  private depthSnapshot: { h: Float32Array; solver: Solver } | null = null;
  private lastSnapshotAt = 0;
  private snapshotPending = false;
  private canvas!: HTMLCanvasElement;
  private readonly tiles = new TilesClient();
  /** Peru relief shown first ("vista general"); while active the simulator neither renders nor steps. */
  private overview!: PeruOverview;
  private overviewActive = false;
  private lodProfile!: LodProfile;
  /** Real Peru relief around a "Simular aquí" terrain (S1); empty for the other terrains. */
  private mapContext!: MapContextView;
  /** Satellite imagery (S7): provider from the Vite env, loaded directly by the browser (decision L7). */
  private readonly imagery: ImageryAvailability = resolveImagery(import.meta.env as ImageryEnv);
  /** Relieve / Satélite, shared by the overview and the simulator's map context. */
  private imageryMode: ImageryMode = defaultImageryMode(this.imagery);
  private imageryAttributionRequested = false;
  /** The switch over the simulator (shown only with a map context). */
  private simImagery!: ImageryToggle;
  /** Weather layers (S8): one client for the overview, its VR and the map context (window.__app.weather). */
  weather!: WeatherController;
  private weatherGpu!: WeatherGpu;
  private simWeather!: WeatherPanel;

  constructor(private readonly container: HTMLElement) {}

  async start(): Promise<void> {
    const report = await probeCapabilities();
    const caps = summarize(report, { forceWebGPU: new URLSearchParams(location.search).has('forcewebgpu') });
    const canvas = document.createElement('canvas');
    canvas.className = 'scene-canvas';
    this.container.append(canvas);

    this.canvas = canvas;
    const handle = await createEngine(canvas, caps.solverBackend === 'webgpu');
    this.engine = handle.engine;
    this.webgpu = handle.webgpu;
    // The Peru overview loads its tiles while the simulator is built below, exactly as before.
    this.lodProfile = pickLodProfile(report.device, location.search);
    const wxProfile = WEATHER_PROFILES[this.lodProfile.id];
    // A stopped weather backend only disables the weather layers (notice in their panel).
    this.weather = new WeatherController(httpWeatherApi(), { cacheFrames: this.lodProfile.id === 'quest' ? 8 : 24, decodeImage: cloudDecoder(wxProfile.cloudMaxWidth) });
    this.weatherGpu = new WeatherGpu(this.engine, this.weather, wxProfile);
    void this.weather.start();
    this.overview = new PeruOverview(this.engine, canvas, this.container, {
      simulateHere: (p) => this.simulateAt(p),
      openSimulator: () => this.leaveOverview(),
      backToMap: () => this.enterOverview(),
    }, this.lodProfile, { availability: this.imagery, mode: this.imageryMode, onChange: (m) => this.setImageryMode(m) },
    { controller: this.weather, gpu: this.weatherGpu });
    this.requestImageryAttribution();
    const overviewLoad = this.overview.load(this.tiles).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
    if (caps.fallbackReason === 'xr-compat' && !this.webgpu) renderXrCompatNotice(this.container);
    else if (!this.webgpu) renderWebGpuUnavailable(this.container, report, true);
    this.webTargetFps = caps.defaultQuality.targetFps;

    const profile = this.webgpu ? caps.defaultQuality.id : 'low';
    this.store = createAppStore({ profile, emitterPosition: syntheticEmitterPosition(), terrainLabel: 'Quebrada sintética' });
    this.governor = new FpsGovernor({ targetFps: caps.defaultQuality.targetFps });
    this.substepBudget = this.webgpu ? SUBSTEP_BUDGET[profile] : CPU_SUBSTEP_BUDGET;

    this.world = new World(this.engine, canvas);
    this.enterOverview();
    this.hud = new Hud(this.container);
    const panelHost = document.createElement('div');
    panelHost.className = 'panel-host';
    this.container.append(panelHost);

    this.barriers = new BarrierView(this.world.scene, this.world.root);
    this.mapContext = new MapContextView(this.world.scene, this.world.root, this.tiles, this.lodProfile, this.weatherGpu);
    this.simImagery = new ImageryToggle(this.imagery, this.imageryMode, (m) => this.setImageryMode(m), 'imagery-sim');
    this.simImagery.el.hidden = true;
    this.container.append(this.simImagery.el);
    this.simWeather = new WeatherPanel(this.weather, 'weather-sim');
    this.simWeather.el.hidden = true;
    this.container.append(this.simWeather.el);
    this.applyImagery();
    this.sim = await this.buildSimulation(this.terrainGrid(this.resolution()), null);
    this.world.fitTerrain(this.sim.terrain);
    this.syncMapContext();
    this.placeEmitterMarker();
    this.preview = new EditPreviewView(this.world.scene, this.world.root, (x, z) => this.sim.terrain.heightAt(x, z), () => this.sim.terrain.cellSize);
    const ctx = this.toolContext();
    this.tools = { source: new SourceTool(ctx), wall: new WallTool(ctx), erase: new EraseTool(ctx) };

    new Toolbar(this.container, this.store, { undo: () => this.undo(), redo: () => this.redo() });
    new Timeline(this.container, this.store, this.resultActions);
    new ControlPanel(panelHost, this.store, {
      resetSimulation: () => this.resetSimulation(),
      undo: () => this.undo(),
      redo: () => this.redo(),
      loadDem: (file, kind, png) => void this.loadDem(file, kind, png),
      useSyntheticTerrain: () => void this.replaceTerrain({ kind: 'synthetic' }, syntheticEmitterPosition(), 'Quebrada sintética'),
      exportScenario: () => this.exportScenario(),
      importScenario: (file) => void this.importScenario(file),
    }, { qualityEditable: this.webgpu });
    this.bindStore();
    this.bindKeyboard();
    this.bindPointer(canvas);
    // XR renders through XRGPUBinding with WebGPU, or through WebGL; otherwise no button at all.
    const xrRenderable = !this.webgpu || !caps.xrNeedsWebGLRenderer;
    if (xrRenderable && (caps.showVrButton || caps.showArButton)) this.addXrButtons(caps.showVrButton, caps.showArButton);
    if (xrRenderable && caps.showVrButton) this.overview.enableVr(() => this.enterOverviewVr());
    // Only now can the overview hand over to the simulator (A1: this.sim exists from here on).
    this.overview.setSimulatorReady(true);

    // No tiles service: continue to the synthetic simulator as before, with a notice.
    void overviewLoad.then((load) => {
      const start = startScreen(load);
      if (start.screen === 'overview') return;
      if (!load.ok) console.warn('Peru overview unavailable:', load.error);
      this.overview.unavailable();
      this.leaveOverview();
      this.hud.setNotice(start.notice);
    });

    this.engine.runRenderLoop(this.renderLoop);
    window.addEventListener('resize', () => this.engine.resize());
    Object.assign(window, { __app: this });
  }

  /**
   * Shows the Peru overview; the simulation pauses and its camera stops listening. From the
   * simulator's VR (`fromVr`, S2) the shared session keeps the store's session at 'xr'.
   */
  private enterOverview(fromVr = false): void {
    if (this.overviewActive || (this.store.get().session === 'xr' && !fromVr)) return;
    this.overviewActive = true;
    const { tool, playback } = this.store.get();
    if (tool !== 'navigate') this.tools?.[tool].cancel();
    if (playback.playing) this.store.set((s) => ({ playback: { ...s.playback, playing: false } }));
    this.world.camera.detachControl();
    this.hud?.setCursor(null);
    this.container.classList.add('overview-active');
    this.overview.show();
  }

  private leaveOverview(): void {
    // Before the simulator exists there is nothing to show (A1).
    if (!this.overviewActive || !this.sim) return;
    this.overviewActive = false;
    this.overview.hide();
    this.container.classList.remove('overview-active');
    this.world.camera.attachControl(this.canvas, true);
  }

  /**
   * "Simular aquí": real z11 terrain around the point, at the current simulator resolution, via the DEM path.
   * From the VR card (S2) the simulator then takes the same immersive session (maquette view).
   */
  private async simulateAt(p: PickedPoint): Promise<void> {
    if (this.rebuilding || !this.sim) throw new Error('Espera a que termine la carga en curso');
    const fromVr = this.vr.phase === 'map';
    if (fromVr) this.vrDispatch({ type: 'simulate' });
    try {
      const grid = await fetchLocalGrid(this.tiles, p.lon, p.lat, this.resolution());
      if (this.store.get().result.mode === 'result') await this.setResultMode(false);
      const label = peruLabel(p.lon, p.lat);
      const half = (grid.resolution * grid.cellSize) / 2;
      // The debris-flow origin starts at the picked point (the grid centre), shown in place over the real relief.
      await this.replaceTerrain({ kind: 'dem', grid, label, site: { lon: p.lon, lat: p.lat, height: p.height } }, [half, half], label);
      // The headset may have left VR during the download: then it is the web flow.
      if (fromVr && this.vr.phase === 'loading') {
        await this.vrToSimulator();
        this.vrDispatch({ type: 'simulated' });
      } else this.leaveOverview();
    } catch (err) {
      if (fromVr) this.vrDispatch({ type: 'failed', message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  private vrDispatch(e: VrEvent): void {
    this.vr = vrReduce(this.vr, e);
  }

  private async ensureShared(): Promise<SharedXrSession> {
    if (this.shared) return this.shared;
    const { SharedXrSession } = await import('../xr/sharedSession');
    this.shared = new SharedXrSession(this.engine, () => this.engine.runRenderLoop(this.renderLoop), () => this.vrDispatch({ type: 'exit' }));
    return this.shared;
  }

  /** VR card "Simular aquí": the simulator's XR takes the map's session, maquette view first. */
  private async vrToSimulator(): Promise<void> {
    const xr = await this.ensureXr();
    const shared = await this.ensureShared();
    this.store.set((s) => ({ xr: { ...s.xr, mode: 'maquette' } }));
    await shared.handover(xr.experience, () => xr.enter('immersive-vr'), () => {
      this.leaveOverview();
      xr.resume();
    }, () => {
      xr.pause();
      this.enterOverview(true);
    });
  }

  /** "Volver al mapa del Perú" in the simulator's VR panel: the map takes the session back. */
  private async vrBackToMap(): Promise<void> {
    if (!canReturnToMap(this.vr, this.overview.available) || !this.xr) return;
    const xr = this.xr;
    try {
      const map = await this.ensureOverviewXr();
      const shared = await this.ensureShared();
      await shared.handover(map.experience, () => map.enter(), () => {
        xr.pause();
        const t = this.store.get().tool;
        if (t !== 'navigate') this.tools[t].cancel();
        this.preview.clear();
        this.enterOverview(true);
        map.resumed();
      }, () => {
        this.leaveOverview();
        xr.resume();
      });
      this.vrDispatch({ type: 'back-to-map' });
    } catch (err) {
      console.error('No se pudo volver al mapa en VR:', err);
    }
  }

  private resolution(): number {
    return this.webgpu ? QUALITY_PROFILES[this.store.get().quality.profile].solverResolution : CPU_RESOLUTION;
  }

  private terrainGrid(resolution: number): HeightGrid {
    return this.source.kind === 'synthetic' ? createSyntheticRavine(resolution) : resampleGrid(this.source.grid, resolution);
  }

  /** Creates terrain, solver and views; optionally carries a previous simulation's state over. */
  private async buildSimulation(grid: HeightGrid, previous: Simulation | null): Promise<Simulation> {
    const terrain = new Terrain(grid);
    const s = this.store.get();
    // Bake the active walls into the new effective terrain before the solver exists, so a carried-over
    // state is never edited again (that would remove fluid resting on walls a second time).
    const walls = activeWalls(s.history.commands);
    applyEditCpu(terrain.effective, terrain.base, terrain.resolution, terrain.cellSize, { mode: 'replay', walls });
    const solver: Solver = REMOTE
      ? new RemoteSolver(
        REMOTE === 'loopback' ? new LoopbackTransport() : new HttpTransport(REMOTE),
        terrain.resolution, terrain.cellSize, () => this.scenario(), { terrain: terrain.effective, frameInterval: 1, duration: 900 },
      )
      : this.webgpu
      ? await LocalGpuSolver.create(this.engine as WebGPUEngine, terrain.resolution, terrain.cellSize, terrain.base, terrain.effective)
      : new CpuSolver(terrain.resolution, terrain.cellSize, terrain.effective, terrain.base);
    solver.setMaterial(s.material);
    // A fresh simulation starts at t = 0, so origins without a start begin there (not at the old solver's time).
    solver.setEmitters(this.emitters(previous ? this.simTimeNow() : 0));
    if (solver instanceof LocalGpuSolver) solver.setStyle(s.view);

    if (previous) {
      const [state, stats] = await Promise.all([previous.solver.readState(), previous.solver.readStats()]);
      const p = previous.terrain;
      solver.loadState(resampleState(state, p.resolution, terrain.resolution, p.cellSize, terrain.cellSize));
      solver.setClock(stats.simTime, stats.injectedVolume, stats.editRemovedVolume);
      previous.solver.dispose();
      previous.terrainView.dispose();
      previous.flowView.dispose();
    }

    const terrainView = new TerrainView(this.world.scene, this.world.root, terrain, s.view.contours);
    const flowView = new FlowView(this.world.scene, this.world.root, terrain.resolution, terrain.size, terrain.minMax());
    if (solver instanceof LocalGpuSolver) flowView.bindGpu(this.engine, solver.surface);
    else flowView.bindCpu();
    this.appliedWalls = walls;
    this.barriers.update(walls, terrain);
    this.depthSnapshot = null;
    return { terrain, solver, terrainView, flowView };
  }

  private async changeResolution(): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    try {
      this.sim = await this.buildSimulation(this.terrainGrid(this.resolution()), this.sim);
      this.substepBudget = SUBSTEP_BUDGET[this.store.get().quality.profile];
      this.syncMapContext();
      this.xr?.terrainChanged();
    } finally {
      this.rebuilding = false;
    }
    // Origin edits made while rebuilding (undo, erase) reach the new solver here.
    this.syncEmitters();
  }

  /** Swaps the terrain; `commands` (e.g. from a scenario) replace the default single origin. */
  private async replaceTerrain(source: TerrainSource, emitterPosition: [number, number], label: string, commands?: EditCommand[]): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    try {
      this.source = source;
      this.defaultEmitterPosition = emitterPosition;
      const old = this.sim;
      old.solver.dispose();
      old.terrainView.dispose();
      old.flowView.dispose();
      // Walls belong to the terrain they were drawn on; so does a recording.
      this.sourceStarts.clear();
      this.recording.clear();
      this.live = null;
      this.shownFrame = null;
      this.player.pause();
      this.resetClock();
      this.store.set((s) => ({
        emitter: { ...s.emitter, position: emitterPosition },
        terrainLabel: label,
        result: { ...s.result, mode: 'live', recording: false, frames: 0, start: 0, end: 0, time: 0, playing: false },
        history: { commands: commands ?? [newSource(s.emitter, emitterPosition)], redo: [] },
      }));
      this.sim = await this.buildSimulation(this.terrainGrid(this.resolution()), null);
      this.world.fitTerrain(this.sim.terrain);
      this.syncMapContext();
      this.placeEmitterMarker();
      this.hud.setNotice(null);
      this.xr?.terrainChanged();
    } finally {
      this.rebuilding = false;
    }
    // Origin edits made while rebuilding (undo, erase) reach the new solver here.
    this.syncEmitters();
  }

  /**
   * Map context of the current terrain: the real relief around a "Simular aquí" terrain, its
   * overview marker and a wider orbit; "sin contexto" for the synthetic ravine and DEM files.
   */
  private syncMapContext(): void {
    const site = mapSiteOf(this.source);
    const t = this.sim.terrain;
    this.mapContext.set(site, t);
    this.world.setReach(contextCamera(t.size, !!site));
    this.hud?.setContext(contextBadge(site));
    this.simImagery.el.hidden = !site;
    this.simWeather.el.hidden = !site;
    const src = this.source;
    this.overview.setActiveSimulation(site && src.kind === 'dem' && src.site
      ? { lon: site.lon, lat: site.lat, height: src.site.height, size: t.size, label: this.store.get().terrainLabel }
      : null);
  }

  /** "Relieve / Satélite" from either switch: both views follow. */
  private setImageryMode(mode: ImageryMode): void {
    this.imageryMode = mode;
    this.overview.setImageryMode(mode);
    this.simImagery?.set(mode);
    this.applyImagery();
    this.requestImageryAttribution();
  }

  private applyImagery(): void {
    const a = this.imagery;
    this.mapContext?.setImagery(a.available && this.imageryMode === 'satellite' ? a.source : null);
  }

  /** Dynamic provider attribution, fetched once the first time Satélite is shown. */
  private requestImageryAttribution(): void {
    const a = this.imagery;
    if (!a.available || this.imageryMode !== 'satellite' || this.imageryAttributionRequested) return;
    this.imageryAttributionRequested = true;
    void fetchImageryAttribution(a.source).then((text) => {
      this.overview.setImageryAttribution(text);
      this.simImagery?.setAttribution(text);
    });
  }

  /** Debug/verification hook (window.__app.mapContextStats()). */
  mapContextStats() {
    return this.mapContext.stats();
  }

  /** The current scenario: synthetic terrain by name, a loaded DEM embedded inline. */
  scenario(): Scenario {
    const s = this.store.get();
    const terrain = this.source.kind === 'synthetic'
      ? { kind: 'synthetic' as const, size_m: SYNTHETIC_SIZE }
      : encodeInlineTerrain(this.source.grid, this.source.label);
    return buildScenario({ name: s.terrainLabel, terrain, material: s.material, commands: s.history.commands, speed: s.playback.speed });
  }

  private exportScenario(): void {
    const blob = new Blob([serializeScenario(this.scenario())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `escenario-${this.store.get().terrainLabel.replace(/[^\w.-]+/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async importScenario(file: File): Promise<void> {
    try {
      await this.applyScenario(parseScenario(await file.text()), new URL(file.name, location.href));
    } catch (err) {
      this.hud.setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  /** Loads a scenario: terrain, material, speed and the edit history; every origin starts at t = 0. */
  async applyScenario(sc: Scenario, base: URL = new URL(location.href)): Promise<void> {
    if (this.rebuilding) throw new Error('Espera a que termine la carga en curso y vuelve a importar el escenario');
    if (this.store.get().result.mode === 'result') await this.setResultMode(false);
    let source: TerrainSource;
    if (sc.terrain.kind === 'synthetic') source = { kind: 'synthetic' };
    else if (sc.terrain.kind === 'dem-inline') source = { kind: 'dem', grid: decodeInlineTerrain(sc.terrain), label: sc.terrain.label ?? sc.name };
    else {
      this.hud.setNotice(`Cargando ${sc.terrain.uri}…`);
      const res = await fetch(new URL(sc.terrain.uri, base));
      if (!res.ok) throw new Error(`No se pudo descargar el DEM ${sc.terrain.uri} (${res.status})`);
      const blob = await res.blob();
      const grid = sc.terrain.format === 'geotiff' ? await loadGeoTiff(blob, 512) : await loadPng16(blob, 512, sc.terrain.png ?? { cellSize: 8, minElevation: 0, maxElevation: 1000 });
      source = { kind: 'dem', grid, label: sc.terrain.label ?? sc.terrain.uri };
    }
    const first = sc.origins[0]?.pos;
    const fallback = source.kind === 'synthetic' ? syntheticEmitterPosition() : highestInterior(new Terrain(source.grid));
    this.store.set((s) => ({ material: { ...sc.material }, playback: { ...s.playback, speed: sc.simulation.speed, playing: false } }));
    await this.replaceTerrain(source, first ?? fallback, source.kind === 'synthetic' ? 'Quebrada sintética' : source.label, sc.commands);
  }

  private async loadDem(file: File, kind: 'geotiff' | 'png16', png: PngDemOptions): Promise<void> {
    try {
      this.hud.setNotice(`Cargando ${file.name}…`);
      // Keep the DEM at up to 512² so later resolution changes resample from good data.
      const grid = kind === 'geotiff' ? await loadGeoTiff(file, 512) : await loadPng16(file, 512, png);
      const t = new Terrain(grid);
      await this.replaceTerrain({ kind: 'dem', grid, label: file.name }, highestInterior(t), file.name);
    } catch (err) {
      this.hud.setNotice(`No se pudo cargar el DEM: ${String(err)}`);
    }
  }

  /** Solver emitters for the active origin commands, each with its start time. */
  private emitters(now = this.simTimeNow()) {
    const { history, emitter } = this.store.get();
    const sources = activeSources(history.commands);
    const active = new Set(sources.map((c) => c.id));
    for (const id of this.sourceStarts.keys()) if (!active.has(id)) this.sourceStarts.delete(id);
    return sources.map((c) => {
      // An origin starts when it appears (placed or redone); paused before play that is t = 0 for all.
      if (!this.sourceStarts.has(c.id)) this.sourceStarts.set(c.id, now);
      return sourceEmitter(c, this.sourceStarts.get(c.id)!, emitter.enabled);
    });
  }

  private syncEmitters(): void {
    // During a rebuild the old solver may already be disposed; the rebuild syncs when it ends.
    // While replaying a result, origins reach the live run when it is restored.
    if (this.rebuilding || this.live) return;
    this.sim.solver.setEmitters(this.emitters());
    this.placeEmitterMarker();
  }

  /** Simulation time now: exact on the CPU solver, extrapolated from the last stats on the GPU. */
  private simTimeNow(): number {
    // While a result is replayed, the solver clock shows the frame; the live run is parked.
    if (this.live) return this.live.stats.simTime;
    const solver = this.sim?.solver;
    if (solver instanceof CpuSolver) return solver.simTime;
    return this.clock.base + (this.clock.requested - this.clock.baseRequested);
  }

  private placeEmitterMarker(): void {
    const { history, emitter } = this.store.get();
    const terrain = this.sim.terrain;
    const list = activeSources(history.commands).map((c) => ({ position: c.pos, radius: c.radius, groundY: terrain.heightAt(c.pos[0], c.pos[1]) }));
    this.world.placeEmitters(list, emitter.enabled);
  }

  private bindStore(): void {
    const st = this.store;
    st.watch((s) => s.material, (m) => this.sim.solver.setMaterial(m));
    // Panel volume/peak/radius apply to new origins; the switch turns every origin on or off.
    st.watch((s) => s.emitter.enabled, () => this.syncEmitters());
    st.watch((s) => s.view, (v) => {
      if (this.sim.solver instanceof LocalGpuSolver) this.sim.solver.setStyle(v);
      this.sim.terrainView.setContours(v.contours);
    });
    st.watch((s) => activeSources(s.history.commands), () => this.syncEmitters(), sameIds);
    st.watch((s) => s.tool, (tool, prev) => {
      if (prev !== 'navigate') this.tools[prev].cancel();
      this.world.setEditMode(tool !== 'navigate');
      this.hud.setNotice(null);
    });
    st.watch((s) => s.quality, (q, prev) => {
      // The CPU plan-B solver has a fixed, small resolution.
      if (q.profile !== prev.profile && this.webgpu) {
        this.governor.reset();
        this.setRenderScale(1);
        void this.changeResolution();
      }
    });
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (this.overviewActive) return;
      const st = this.store;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        this.redo();
        return;
      }
      if (mod) return;
      const toolKeys: Record<string, ToolId> = { n: 'navigate', o: 'source', m: 'wall', b: 'erase' };
      const tool = toolKeys[e.key.toLowerCase()];
      if (tool) {
        st.set({ tool });
        return;
      }
      if (e.key === 'Escape') {
        const t = st.get().tool;
        if (t !== 'navigate') this.tools[t].cancel();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (st.get().result.mode === 'result') this.resultActions.togglePlay();
        else st.set((s) => ({ playback: { ...s.playback, playing: !s.playback.playing } }));
      } else if (e.key === 'r' || e.key === 'R') {
        this.resetSimulation();
      } else if (e.key === '+' || e.key === '=') {
        st.set((s) => ({ playback: { ...s.playback, speed: Math.min(60, s.playback.speed + 1) } }));
      } else if (e.key === '-') {
        st.set((s) => ({ playback: { ...s.playback, speed: Math.max(1, s.playback.speed - 1) } }));
      }
    });
  }

  /** Mouse/touch/pen become rays; the active tool turns them into edit commands. */
  private bindPointer(canvas: HTMLCanvasElement): void {
    const hub = this.pointerHub;
    hub.add(new DomPointerSource(canvas, (x, y) => this.world.screenRay(x, y), {
      captureRoot: this.container,
      // With an editing tool active, the left mouse button / pen belongs to the tool, not the camera.
      claim: (e) => this.store.get().tool !== 'navigate' && e.pointerType !== 'touch' && e.button === 0,
    }));
    hub.subscribe((p) => this.onPointer(p));
  }

  /** Single entry point for every pointer kind: mouse, touch, pen, XR controllers and hands. */
  onPointer(p: PointerSample): void {
    if (this.rebuilding || this.overviewActive) return;
    // Inside a session only XR pointers edit (the page canvas may still get mouse events).
    const xrPointer = p.kind === 'xr-controller' || p.kind === 'xr-hand';
    if ((this.store.get().session === 'xr') !== xrPointer) return;
    if (p.kind === 'mouse' && p.phase === 'move') {
      const hit = raycastHeightField(this.sim.terrain, this.world.toTerrainLocal(p.ray));
      this.hud.setCursor(hit ? `Cursor: x ${hit.point[0].toFixed(0)} m · z ${hit.point[2].toFixed(0)} m · cota ${hit.point[1].toFixed(1)} m` : null);
    }
    const { tool, result } = this.store.get();
    // A replayed result is read-only: edits apply to the live simulation only.
    if (tool !== 'navigate' && result.mode === 'live') this.tools[tool].onPointer(p);
  }

  private toolContext(): ToolContext {
    return {
      pick: (ray) => {
        const hit = raycastHeightField(this.sim.terrain, this.world.toTerrainLocal(ray));
        if (!hit) return null;
        // Maquette: one hand movement spans many terrain metres, so aimed points can snap to a grid.
        const { session, xr } = this.store.get();
        const point: Vec2 = [hit.point[0], hit.point[2]];
        return session === 'xr' && xr.mode === 'maquette' ? snapPoint(point, xr.snap) : point;
      },
      dispatch: (cmd: EditCommand) => this.store.set((s) => ({ history: push(s.history, cmd) })),
      wallSettings: () => this.store.get().wall,
      canAddWall: () => activeWalls(this.store.get().history.commands).length < MAX_WALLS,
      sourceSettings: () => this.store.get().emitter,
      wallBlocked: (points, halfWidth, material) => this.wallBlocked(points, halfWidth, material),
      targetAt: (x, z) => targetAt(this.store.get().history.commands, x, z, this.sim.terrain.cellSize),
      canAddSource: () => activeSources(this.store.get().history.commands).length < MAX_EMITTERS,
      minSegment: () => Math.max(this.sim.terrain.cellSize * 1.5, this.store.get().wall.halfWidth * 0.5),
      notify: (msg) => this.hud.setNotice(msg),
      confirmed: (p) => {
        if (p.kind === 'touch') navigator.vibrate?.(15);
        else if (p.kind === 'xr-controller') this.xr?.pulse(p.id);
      },
      preview: this.preview,
    };
  }

  /** Placement policy (1): no walls where the flow is deeper than the threshold. */
  private wallBlocked(points: Vec2[], realHalfWidth: number, material: WallMaterial): boolean {
    const snap = this.depthSnapshot;
    if (!snap || snap.solver !== this.sim.solver) return false;
    const { resolution: n, cellSize: dx } = this.sim.terrain;
    const limit = this.store.get().wall.maxFlowDepth;
    const wall: WallCommand = { type: 'wall', id: '', points, halfWidth: realHalfWidth, height: 0, material };
    const halfWidth = wallProfile(wall, dx).halfWidth;
    const [minX, minZ, maxX, maxZ] = wallBounds(wall, dx);
    const i0 = Math.max(0, Math.floor(minX / dx));
    const i1 = Math.min(n - 1, Math.ceil(maxX / dx));
    const j0 = Math.max(0, Math.floor(minZ / dx));
    const j1 = Math.min(n - 1, Math.ceil(maxZ / dx));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (snap.h[j * n + i] > limit && distToPolyline((i + 0.5) * dx, (j + 0.5) * dx, points) <= halfWidth) return true;
      }
    }
    return false;
  }

  private refreshDepthSnapshot(now: number): void {
    if (this.store.get().tool !== 'wall' || this.snapshotPending || now - this.lastSnapshotAt < DEPTH_SNAPSHOT_MS) return;
    this.snapshotPending = true;
    this.lastSnapshotAt = now;
    const solver = this.sim.solver;
    solver.readState().then((st) => {
      this.snapshotPending = false;
      if (solver === this.sim.solver) this.depthSnapshot = { h: st.h, solver };
    }, () => {
      this.snapshotPending = false;
    });
  }

  private undo(): void {
    this.store.set((s) => ({ history: undo(s.history) }));
  }

  private redo(): void {
    this.store.set((s) => ({ history: redo(s.history) }));
  }

  /**
   * Brings the solver terrain and the CPU copy in line with the command list:
   * one edit pass per frame, before the solver step, so the response is visible
   * in the same frame.
   */
  private flushEdits(): void {
    const next = activeWalls(this.store.get().history.commands);
    const batch = planEdit(this.appliedWalls, next);
    if (!batch) return;
    const { solver, terrain, terrainView } = this.sim;
    solver.applyEdit(batch);
    const region = applyEditCpu(terrain.effective, terrain.base, terrain.resolution, terrain.cellSize, batch);
    if (region) terrainView.refreshRegion(region);
    this.appliedWalls = next;
    this.barriers.update(next, terrain);
    this.placeEmitterMarker();
  }

  /** "Reiniciar escenario": flow back to zero, commands kept. */
  private resetClock(): void {
    this.clock.base = 0;
    this.clock.baseRequested = this.clock.requested;
    // Stats requested before this point describe the old run.
    this.clock.epoch++;
  }

  // --- Recording and result mode -------------------------------------------------------------

  /** Actions for the web timeline and the 3D panel. */
  readonly resultActions: ResultActions = {
    toggleRecording: () => {
      const on = !this.store.get().result.recording;
      if (on) {
        this.recording.clear();
        this.lastRecordedSim = -Infinity;
        const n = this.sim.solver.resolution;
        this.recording.maxFrames = Math.max(20, Math.min(MAX_FRAMES, Math.floor(RECORDING_BUDGET_BYTES / (n * n * 12))));
      }
      this.store.set((s) => ({ result: { ...s.result, recording: on } }));
      this.syncResult();
    },
    setResultMode: (on) => void this.setResultMode(on),
    togglePlay: () => {
      if (this.player.playing) this.player.pause();
      else this.player.play();
      this.syncResult();
    },
    step: (d) => {
      this.player.step(d);
      this.syncResult();
    },
    seek: (t) => {
      this.player.seek(t);
      this.syncResult();
    },
    setSpeed: (v) => {
      this.player.speed = v;
      this.syncResult();
    },
  };

  /** Samples the live run every RECORD_INTERVAL_S simulated seconds (async readback, one at a time). */
  private recordFrame(): void {
    if (this.recordPending || this.simTimeNow() - this.lastRecordedSim < RECORD_INTERVAL_S) return;
    this.recordPending = true;
    const solver = this.sim.solver;
    const epoch = this.clock.epoch;
    void Promise.all([solver.readState(), solver.readStats()]).then(([state, stats]) => {
      this.recordPending = false;
      // Drop readbacks from before a reset or a rebuild, or after recording stopped.
      if (solver !== this.sim.solver || epoch !== this.clock.epoch || !this.store.get().result.recording) return;
      this.lastRecordedSim = stats.simTime;
      this.recording.add({ simTime: stats.simTime, resolution: solver.resolution, state, injectedVolume: stats.injectedVolume, editRemovedVolume: stats.editRemovedVolume });
      this.syncResult();
    });
  }

  private async setResultMode(on: boolean): Promise<void> {
    const mode = this.store.get().result.mode;
    if (on === (mode === 'result')) return;
    const solver = this.sim.solver;
    if (on) {
      if (this.recording.length < 2) {
        this.hud.setNotice('Graba al menos dos fotogramas (botón Grabar con la simulación en marcha) para ver el resultado');
        return;
      }
      const [state, stats] = await Promise.all([solver.readState(), solver.readStats()]);
      // A rebuild (terrain or resolution change) during the readback would park a stale state.
      if (solver !== this.sim.solver || this.rebuilding || this.store.get().result.mode === 'result') return;
      this.live = { state, stats, resolution: solver.resolution, cellSize: solver.cellSize };
      this.player.pause();
      this.player.seek(this.player.time);
      this.shownFrame = null;
      this.store.set((s) => ({ playback: { ...s.playback, playing: false }, result: { ...s.result, mode: 'result', recording: false } }));
    } else {
      this.player.pause();
      if (this.live) {
        // The resolution may have changed while replaying.
        const l = this.live;
        solver.loadState(l.resolution === solver.resolution ? l.state : resampleState(l.state, l.resolution, solver.resolution, l.cellSize, solver.cellSize));
        solver.setClock(l.stats.simTime, l.stats.injectedVolume, l.stats.editRemovedVolume);
      }
      const liveTime = this.live?.stats.simTime ?? 0;
      this.live = null;
      this.shownFrame = null;
      // Stats polled during the replay describe frames, not the live run.
      this.clock.base = liveTime;
      this.clock.baseRequested = this.clock.requested;
      this.clock.epoch++;
      this.store.set((s) => ({ result: { ...s.result, mode: 'live' } }));
      // Apply undo/redo and origin changes made while replaying, at the live time.
      this.flushEdits();
      this.syncEmitters();
    }
    this.syncResult();
  }

  /** Result mode, per frame: advance the playhead and load the frame it points at into the solver. */
  private replayFrame(frameMs: number): void {
    const wasPlaying = this.player.playing;
    this.player.tick(Math.min(frameMs, 100) / 1000);
    const frame = this.player.current();
    if (frame && frame !== this.shownFrame) {
      const solver = this.sim.solver;
      const n = solver.resolution;
      // Frames recorded on another grid (or computed at high resolution elsewhere) are resampled.
      const size = n * solver.cellSize;
      const state = frame.resolution === n ? frame.state : resampleState(frame.state, frame.resolution, n, size / frame.resolution, solver.cellSize);
      solver.loadState(state);
      solver.setClock(frame.simTime, frame.injectedVolume ?? 0, frame.editRemovedVolume ?? 0);
      this.shownFrame = frame;
    }
    const r = this.store.get().result;
    if (wasPlaying !== this.player.playing || Math.abs(r.time - this.player.time) > 0.25) this.syncResult();
  }

  /** Mirrors the recording and the playhead into the store (read by the timeline and the 3D panel). */
  private syncResult(): void {
    this.store.set((s) => ({
      result: {
        ...s.result, frames: this.recording.length, start: this.recording.start, end: this.recording.end,
        time: this.player.time, playing: this.player.playing, speed: this.player.speed,
      },
    }));
  }

  private resetSimulation(): void {
    // In result mode "reset" rewinds the replay; the live run is untouched.
    if (this.store.get().result.mode === 'result') return this.resultActions.seek(this.recording.start);
    this.sim.solver.reset();
    this.resetClock();
    // A recording covers one run: restart it, so the timeline never mixes two.
    if (this.recording.length || this.store.get().result.recording) {
      this.recording.clear();
      this.lastRecordedSim = -Infinity;
      this.syncResult();
    }
    // Every origin starts again from t = 0.
    for (const id of this.sourceStarts.keys()) this.sourceStarts.set(id, 0);
    this.syncEmitters();
  }

  /** "Entrar en VR/AR" buttons; the XR module is only downloaded when one is pressed. */
  private addXrButtons(vr: boolean, ar: boolean): void {
    const bar = document.createElement('div');
    bar.className = 'xr-buttons';
    const add = (label: string, mode: XRSessionMode) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.onclick = async () => {
        b.disabled = true;
        try {
          const xr = await this.ensureXr();
          await xr.enter(mode);
          (await this.ensureShared()).started(xr.experience, mode);
          this.vrDispatch({ type: 'enter-simulator', mode });
        } catch (err) {
          this.hud.setNotice(`No se pudo entrar en ${label.replace('Entrar en ', '')}: ${String(err)}`);
        } finally {
          b.disabled = false;
        }
      };
      bar.append(b);
    };
    if (vr) add('Entrar en VR', 'immersive-vr');
    if (ar) add('Entrar en AR', 'immersive-ar');
    this.container.append(bar);
  }

  /** "Entrar en VR" from the Peru overview: fly over the relief (src/xr/OverviewXr.ts). */
  private async enterOverviewVr(): Promise<void> {
    const map = await this.ensureOverviewXr();
    await map.enter();
    (await this.ensureShared()).started(map.experience, 'immersive-vr');
    this.vrDispatch({ type: 'enter-map' });
  }

  private async ensureOverviewXr(): Promise<OverviewXr> {
    if (this.overviewXr) return this.overviewXr;
    const { OverviewXr } = await import('../xr/OverviewXr');
    this.overviewXr = await OverviewXr.create(this.overview, this.webgpu, { state: () => this.vr, dispatch: (e) => this.vrDispatch(e) });
    return this.overviewXr;
  }

  private async ensureXr(): Promise<XrController> {
    if (this.xr) return this.xr;
    const { XrController } = await import('../xr/XrController');
    this.xr = await XrController.create({
      scene: this.world.scene,
      world: this.world,
      store: this.store,
      webgpu: this.webgpu,
      terrain: () => this.sim.terrain,
      terrainMesh: () => this.sim.terrainView.mesh,
      startPoint: () => activeSources(this.store.get().history.commands)[0]?.pos ?? this.defaultEmitterPosition,
      resetSimulation: () => this.resetSimulation(),
      result: this.resultActions,
      onSessionChange: (inXr) => this.onXrSession(inXr),
      backToMap: () => void this.vrBackToMap(),
      mapAvailable: () => this.overview.available,
    });
    this.pointerHub.add(this.xr.pointers);
    return this.xr;
  }

  /** XR targets 72 fps (Quest); render-scale changes do not apply to the XR framebuffer. */
  private onXrSession(inXr: boolean): void {
    const t = this.store.get().tool;
    if (t !== 'navigate') this.tools[t].cancel();
    this.preview.clear();
    this.setRenderScale(1);
    this.governor = new FpsGovernor({ targetFps: inXr ? QUEST_TARGET_FPS : this.webTargetFps });
    // Leaving XR re-frames the terrain (World.fitTerrain): restore the map-context reach.
    if (!inXr) this.world.setReach(contextCamera(this.sim.terrain.size, this.mapContext.active));
    // The session ended on the Peru map (S2): Babylon re-attached the simulator camera behind it.
    if (!inXr && this.overviewActive) this.world.camera.detachControl();
    this.hud.setNotice(null);
  }

  private setRenderScale(scale: number): void {
    this.renderScale = scale;
    this.engine.setHardwareScalingLevel(scale / Math.min(window.devicePixelRatio, 2));
  }

  private frame(): void {
    if (this.overviewActive) {
      this.overview.render();
      return;
    }
    if (this.rebuilding) {
      this.world.scene.render();
      return;
    }
    const s = this.store.get();
    this.updateMapContext(s);
    const frameMs = this.engine.getDeltaTime();
    // History changes made while replaying wait for the live run (see setResultMode).
    if (s.result.mode === 'live') this.flushEdits();
    const { solver, flowView } = this.sim;
    const now = performance.now();
    this.refreshDepthSnapshot(now);
    if (solver instanceof LocalGpuSolver && s.playback.playing && now - this.lastTimingAt > TIMING_INTERVAL_MS) {
      this.lastTimingAt = now;
      solver.requestTiming();
    }
    let cpuStepMs: number | null = null;
    const t0 = performance.now();
    if (s.result.mode === 'result') this.replayFrame(frameMs);
    else if (s.playback.playing) {
      const simSeconds = (s.playback.speed * Math.min(frameMs, 50)) / 1000;
      solver.advance(simSeconds, this.substepBudget);
      this.clock.requested += simSeconds;
    }
    if (s.result.recording && s.result.mode === 'live' && s.playback.playing) this.recordFrame();
    if (solver instanceof CpuSolver && s.playback.playing && s.result.mode === 'live') cpuStepMs = (performance.now() - t0) / CPU_SUBSTEP_BUDGET;
    if (cpuStepMs !== null) this.cpuStepMs = cpuStepMs;
    if (solver instanceof LocalGpuSolver) solver.updateSurface();
    else if (solver instanceof CpuSolver || solver instanceof RemoteSolver) {
      flowView.updateFromCpu({
        n: solver.resolution, dx: solver.cellSize, h: solver.depth, hu: solver.unitDischargeX, hv: solver.unitDischargeZ,
        z: solver.terrain, colorMode: s.view.colorMode, depthScale: s.view.depthScale, speedScale: s.view.speedScale,
      });
    }
    this.world.scene.render();
    this.governFrame(frameMs);
    this.pollStats();
  }

  private updateMapContext(s: AppState): void {
    const cam = this.world.scene.activeCamera;
    if (!cam) return;
    const px = this.engine.getRenderHeight() / Math.min(Math.max(window.devicePixelRatio, 1), 2);
    this.mapContext.update(cam, px, { simulating: s.playback.playing || s.result.playing, inXr: s.session === 'xr' });
  }

  private governFrame(frameMs: number): void {
    if (!this.store.get().quality.auto || !this.webgpu) return;
    const action = this.governor.frame(frameMs);
    const inXr = this.store.get().session === 'xr';
    if (action === 'reduce-render-scale' && !inXr) this.setRenderScale(1.5);
    else if (action === 'reduce-render-scale') this.substepBudget = Math.max(2, Math.floor(this.substepBudget / 2));
    else if (action === 'reduce-substeps') this.substepBudget = Math.max(2, Math.floor(this.substepBudget / 2));
    else if (action === 'step-down-profile') {
      const current = this.store.get().quality.profile;
      const idx = QUALITY_ORDER.indexOf(current);
      if (idx > 0) {
        const next = QUALITY_ORDER[idx - 1];
        this.hud.setNotice(`Rendimiento bajo: perfil reducido a ${next}`);
        this.store.set((st) => ({ quality: { ...st.quality, profile: next } }));
      }
    }
  }

  private pollStats(): void {
    const now = performance.now();
    if (this.statsPending || now - this.lastStatsAt < STATS_INTERVAL_MS) return;
    this.statsPending = true;
    this.lastStatsAt = now;
    const solver = this.sim.solver;
    const requestedAtRead = this.clock.requested;
    const epoch = this.clock.epoch;
    solver.readStats().then((stats) => {
      this.statsPending = false;
      if (solver !== this.sim.solver) return;
      if (epoch === this.clock.epoch) {
        this.clock.base = stats.simTime;
        this.clock.baseRequested = requestedAtRead;
      }
      this.hud.setStats(stats);
      if (solver instanceof RemoteSolver && solver.error) this.hud.setNotice(`Solver remoto: ${solver.error}`);
      this.xr?.setStats(stats, massError(stats));
      this.hud.setFrame({
        fps: this.engine.getFps(),
        stepMs: solver instanceof LocalGpuSolver ? solver.measuredStepMs : this.cpuStepMs,
        substeps: solver instanceof LocalGpuSolver ? solver.lastSubsteps : CPU_SUBSTEP_BUDGET,
        backend: this.webgpu ? 'WebGPU' : 'CPU (plan B, sin WebGPU)',
        resolution: solver.resolution,
        renderScale: this.renderScale,
      });
    }, (err) => {
      this.statsPending = false;
      console.error(err);
    });
  }
}

/** Highest cell inside the central 60 % of the domain: a sensible default source on a DEM. */
function highestInterior(t: Terrain): [number, number] {
  const n = t.resolution;
  const lo = Math.floor(n * 0.2);
  const hi = Math.ceil(n * 0.8);
  let best = -Infinity;
  let pos: [number, number] = [t.size / 2, t.size / 2];
  for (let j = lo; j < hi; j++) {
    for (let i = lo; i < hi; i++) {
      const z = t.effective[j * n + i];
      if (z > best) {
        best = z;
        pos = [(i + 0.5) * t.cellSize, (j + 0.5) * t.cellSize];
      }
    }
  }
  return pos;
}

const sameIds = (a: { id: string }[], b: { id: string }[]) => a.length === b.length && a.every((c, k) => c.id === b[k].id);
