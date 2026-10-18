import type { AbstractEngine } from '@babylonjs/core';
import { fetchImageryAttribution, resolveImagery, type ImageryAvailability, type ImageryEnv, type ImageryMode } from '../map/imagery/imagerySource';
import { pickLodProfile, type LodProfile } from '../map/lod/lodProfile';
import { PeruOverview } from '../map/PeruOverview';
import { startScreen, TilesClient } from '../map/tilesClient';
import { WeatherController } from '../map/weather/WeatherController';
import { WeatherGpu, WEATHER_PROFILES } from '../map/weather/WeatherGpu';
import { cloudDecoder, httpWeatherApi } from '../map/weather/weatherApi';
import { probeCapabilities, summarize, type CapabilitySummary } from '../platform/capabilities';
import { createEngine } from '../render/engine';
import { defaultImageryMode } from '../ui/web/ImageryToggle';
import { renderWebGpuUnavailable, renderXrCompatNotice } from '../ui/web/unsupported';
import type { OverviewXr } from '../xr/OverviewXr';
import type { SharedXrSession } from '../xr/sharedSession';
import { canReturnToMap, VR_OFF, vrReduce, type VrEvent, type VrState } from '../xr/vrMode';
import { ModeSwitcher, type ViewerScreen } from './ModeSwitcher';
import { resolveEndpoints, type XrViewerEndpointOptions } from './options';
import type { ModeHost, ModeVr, ModeXr, SimulatorMode, SimulatorModeFactory } from './SimulatorMode';

export interface XrViewerOptions extends XrViewerEndpointOptions {
  /** Simulator modes; the first one answers "Simular aquí" and "Ir al simulador". */
  modes: SimulatorModeFactory[];
  /** Satellite imagery provider keys (defaults to the Vite env of the page). */
  imageryEnv?: ImageryEnv;
  /** Opens this mode instead of the Peru map once everything is built. */
  initialMode?: string;
  onScreenChange?(screen: ViewerScreen): void;
}

/**
 * The viewer shell: one engine and canvas, the Peru overview, weather layers, tiles and
 * satellite imagery, the VR session shared by the map and the simulators (S2), the render
 * loop and the global listeners. Simulators plug in as modes (src/viewer/SimulatorMode.ts).
 */
export class XrViewer {
  private engine: AbstractEngine | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private webgpu = false;
  private caps: CapabilitySummary | null = null;
  private lodProfile: LodProfile | null = null;
  private tiles: TilesClient | null = null;
  overview: PeruOverview | null = null;
  weather: WeatherController | null = null;
  private weatherGpu: WeatherGpu | null = null;
  private switcher: ModeSwitcher<SimulatorMode> | null = null;
  private modes: SimulatorMode[] = [];
  private readonly imagery: ImageryAvailability;
  private imageryMode: ImageryMode;
  private imageryAttributionRequested = false;
  /** VR inside one session (S2): map (vuelo / maqueta) ↔ simulator; see src/xr/vrMode.ts. */
  private vr: VrState = VR_OFF;
  /** The immersive session shared by the map and the simulators' XR (lazy, with the XR code). */
  private shared: SharedXrSession | null = null;
  /** VR flight over the Peru overview; lazy-loaded like the simulators' XR. */
  private overviewXr: OverviewXr | null = null;
  private ready = false;
  private starting = false;
  private disposed = false;
  private readonly initialChildren: Set<Node>;
  private addedClasses: string[] = [];
  private readonly renderLoop = () => this.switcher?.frame();
  private readonly onResize = () => this.engine?.resize();
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (!this.switcher || this.switcher.overviewActive) return;
    this.switcher.active.handleKey(event);
  };

  constructor(private readonly container: HTMLElement, private readonly options: XrViewerOptions) {
    this.initialChildren = new Set(container.childNodes);
    this.imagery = resolveImagery(options.imageryEnv ?? (import.meta.env as ImageryEnv));
    this.imageryMode = defaultImageryMode(this.imagery);
  }

  get activeScreen(): ViewerScreen | null {
    if (!this.switcher) return null;
    return this.switcher.overviewActive ? 'overview' : this.switcher.active.id;
  }

  mode(id: string): SimulatorMode | undefined {
    return this.switcher?.mode(id);
  }

  async start(): Promise<void> {
    this.starting = true;
    try {
      await this.build();
    } finally {
      this.starting = false;
      if (this.disposed) this.teardown();
    }
  }

  private async build(): Promise<void> {
    const report = await probeCapabilities();
    if (this.disposed) return;
    const caps = summarize(report, { forceWebGPU: new URLSearchParams(location.search).has('forcewebgpu') });
    this.caps = caps;
    const endpoints = resolveEndpoints(this.options, import.meta.env as { VITE_TILES_URL?: string });
    this.tiles = new TilesClient(endpoints.tilesBaseUrl, undefined, undefined, endpoints.credentials);
    this.addedClasses = ['app', 'xr-viewer'].filter((name) => !this.container.classList.contains(name));
    this.container.classList.add(...this.addedClasses);
    const canvas = document.createElement('canvas');
    canvas.className = 'scene-canvas';
    this.container.append(canvas);
    this.canvas = canvas;
    const handle = await createEngine(canvas, caps.solverBackend === 'webgpu');
    this.engine = handle.engine;
    this.webgpu = handle.webgpu;
    if (this.disposed) return;
    const engine = handle.engine;
    // The Peru overview loads its tiles while the simulators are built below.
    const lodProfile = pickLodProfile(report.device, location.search);
    this.lodProfile = lodProfile;
    const weatherProfile = WEATHER_PROFILES[lodProfile.id];
    // A stopped weather backend only disables the weather layers (notice in their panel).
    const weather = new WeatherController(httpWeatherApi(endpoints.weatherBaseUrl, endpoints.credentials), {
      cacheFrames: lodProfile.id === 'quest' ? 8 : 24,
      decodeImage: cloudDecoder(weatherProfile.cloudMaxWidth),
    });
    this.weather = weather;
    this.weatherGpu = new WeatherGpu(engine, weather, weatherProfile);
    void weather.start();
    const overview = new PeruOverview(engine, canvas, this.container, {
      simulateHere: (point) => this.primaryMode().open(point),
      openSimulator: () => this.showMode(this.primaryMode().id),
      backToMap: () => this.showOverview(),
    }, lodProfile, { availability: this.imagery, mode: this.imageryMode, onChange: (mode) => this.setImageryMode(mode) },
    { controller: weather, gpu: this.weatherGpu });
    this.overview = overview;
    this.requestImageryAttribution();
    const overviewLoad = overview.load(this.tiles).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
    if (caps.fallbackReason === 'xr-compat' && !this.webgpu) renderXrCompatNotice(this.container);
    else if (!this.webgpu) renderWebGpuUnavailable(this.container, report, true);

    const host = this.modeHost();
    const modes = this.options.modes.map((factory) => factory(host));
    this.modes = modes;
    this.switcher = new ModeSwitcher(modes, overview, (screen) => {
      this.container.classList.toggle('overview-active', screen === 'overview');
      if (screen !== 'overview') this.container.dataset.activeMode = screen;
      this.options.onScreenChange?.(screen);
    });
    this.container.dataset.activeMode = this.primaryMode().id;
    this.switcher.showOverview();
    for (const mode of modes) {
      await mode.start();
      if (this.disposed) return;
      mode.imageryChanged(this.imageryMode, this.imagerySource());
    }
    for (const mode of modes) if (mode.entryLabel) overview.addEntry(mode.entryLabel, () => mode.open(null));
    // XR renders through XRGPUBinding with WebGPU, or through WebGL; otherwise no button at all.
    const xrRenderable = !this.webgpu || !caps.xrNeedsWebGLRenderer;
    if (xrRenderable && caps.showVrButton) overview.enableVr(() => this.enterOverviewVr());
    // Only now can the overview hand over to the simulators.
    this.ready = true;
    overview.setSimulatorReady(true);

    // No tiles service: continue to the first simulator, with a notice.
    void overviewLoad.then((load) => {
      if (this.disposed) return;
      const start = startScreen(load);
      if (start.screen === 'overview') return;
      if (!load.ok) console.warn('Peru overview unavailable:', load.error);
      overview.unavailable();
      this.showMode(this.primaryMode().id);
      this.primaryMode().notify(start.notice);
    });
    const initialMode = this.options.initialMode ? this.switcher.mode(this.options.initialMode) : undefined;
    if (initialMode) void initialMode.open(null);

    engine.runRenderLoop(this.renderLoop);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** Stops rendering and releases the engine, the listeners, the XR session and the DOM it added. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // A start still awaiting tears down when it settles.
    if (!this.starting) this.teardown();
  }

  private teardown(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    this.engine?.stopRenderLoop();
    this.shared?.dispose();
    this.switcher?.dispose();
    this.overview?.dispose();
    this.weatherGpu?.dispose();
    this.weather?.dispose();
    this.engine?.dispose();
    for (const node of [...this.container.childNodes]) if (!this.initialChildren.has(node)) node.remove();
    this.container.classList.remove(...this.addedClasses, 'overview-active');
    delete this.container.dataset.activeMode;
  }

  private primaryMode(): SimulatorMode {
    const [primary] = this.modes;
    if (!primary) throw new Error('El visor aún no está listo');
    return primary;
  }

  private modeHost(): ModeHost {
    const engine = this.engine;
    const canvas = this.canvas;
    const caps = this.caps;
    const tiles = this.tiles;
    const lodProfile = this.lodProfile;
    const weather = this.weather;
    const weatherGpu = this.weatherGpu;
    const overview = this.overview;
    if (!engine || !canvas || !caps || !tiles || !lodProfile || !weather || !weatherGpu || !overview) throw new Error('El visor aún no está listo');
    const vr: ModeVr = {
      state: () => this.vr,
      dispatch: (event) => this.vrDispatch(event),
      started: async (xr, mode) => {
        (await this.ensureShared()).started(xr.member, mode);
        this.vrDispatch({ type: 'enter-simulator', mode });
      },
      takeFromMap: (modeId, xr) => this.vrToMode(modeId, xr),
      backToMap: (xr) => this.vrBackToMap(xr),
    };
    return {
      engine, canvas, container: this.container, webgpu: this.webgpu, caps, tiles, lodProfile, weather, weatherGpu, overview,
      imagery: this.imagery,
      vr,
      imageryMode: () => this.imageryMode,
      setImageryMode: (mode) => this.setImageryMode(mode),
      overviewActive: () => this.switcher?.overviewActive ?? true,
      showOverview: (fromVr) => this.showOverview(fromVr),
      showMode: (modeId) => this.showMode(modeId),
    };
  }

  /** Shows the Peru overview. From a mode's VR (`fromVr`, S2) the shared session stays on. */
  private showOverview(fromVr = false): void {
    const switcher = this.switcher;
    if (!switcher || switcher.overviewActive || (switcher.active.presenting() && !fromVr)) return;
    switcher.showOverview();
  }

  private showMode(modeId: string): void {
    // Before the simulators exist there is nothing to show.
    if (!this.ready || !this.switcher) return;
    this.switcher.showMode(modeId);
  }

  /** "Relieve / Satélite" from any switch: the overview and every mode follow. */
  private setImageryMode(mode: ImageryMode): void {
    this.imageryMode = mode;
    this.overview?.setImageryMode(mode);
    for (const simulator of this.modes) simulator.imageryChanged(mode, this.imagerySource());
    this.requestImageryAttribution();
  }

  private imagerySource() {
    const availability = this.imagery;
    return availability.available && this.imageryMode === 'satellite' ? availability.source : null;
  }

  /** Dynamic provider attribution, fetched once the first time Satélite is shown. */
  private requestImageryAttribution(): void {
    const availability = this.imagery;
    if (!availability.available || this.imageryMode !== 'satellite' || this.imageryAttributionRequested) return;
    this.imageryAttributionRequested = true;
    void fetchImageryAttribution(availability.source).then((text) => {
      this.overview?.setImageryAttribution(text);
      for (const simulator of this.modes) simulator.imageryAttribution(text);
    });
  }

  private vrDispatch(event: VrEvent): void {
    this.vr = vrReduce(this.vr, event);
  }

  private async ensureShared(): Promise<SharedXrSession> {
    if (this.shared) return this.shared;
    const engine = this.engine;
    if (!engine) throw new Error('El visor aún no está listo');
    const { SharedXrSession } = await import('../xr/sharedSession');
    this.shared = new SharedXrSession(engine, () => engine.runRenderLoop(this.renderLoop), () => this.vrDispatch({ type: 'exit' }));
    return this.shared;
  }

  /** VR card "Simular aquí": the mode's XR takes the map's session. */
  private async vrToMode(modeId: string, xr: ModeXr): Promise<void> {
    const shared = await this.ensureShared();
    await shared.handover(xr.member, () => xr.enter('immersive-vr'), () => {
      this.showMode(modeId);
      xr.resume();
    }, () => {
      xr.pause();
      this.showOverview(true);
    });
  }

  /** "Volver al mapa del Perú" in a mode's VR panel: the map takes the session back. */
  private async vrBackToMap(xr: ModeXr): Promise<void> {
    const overview = this.overview;
    const switcher = this.switcher;
    if (!overview || !switcher || !canReturnToMap(this.vr, overview.available)) return;
    const modeId = switcher.active.id;
    try {
      const map = await this.ensureOverviewXr();
      const shared = await this.ensureShared();
      await shared.handover(map.experience, () => map.enter(), () => {
        xr.pause();
        this.showOverview(true);
        map.resumed();
      }, () => {
        this.showMode(modeId);
        xr.resume();
      });
      this.vrDispatch({ type: 'back-to-map' });
    } catch (err) {
      console.error('No se pudo volver al mapa en VR:', err);
    }
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
    const overview = this.overview;
    if (!overview) throw new Error('El visor aún no está listo');
    const { OverviewXr } = await import('../xr/OverviewXr');
    this.overviewXr = await OverviewXr.create(overview, this.webgpu, { state: () => this.vr, dispatch: (event) => this.vrDispatch(event) });
    return this.overviewXr;
  }
}
