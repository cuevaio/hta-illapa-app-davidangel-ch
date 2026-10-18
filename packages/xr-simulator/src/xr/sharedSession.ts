import { WebXRFeatureName, type AbstractEngine, type WebXRExperienceHelper, type WebXRInput } from '@babylonjs/core';

/**
 * What the shared session needs from an XR experience: a WebXRDefaultExperience, or an
 * experience assembled by hand (helper + input) such as the structures simulator's.
 */
export interface XrSessionMember {
  readonly baseExperience: WebXRExperienceHelper;
  readonly input: WebXRInput;
}

/**
 * One immersive session shared by two Babylon XR experiences (S2): the Peru map
 * (src/xr/OverviewXr.ts, overview scene) and the simulator (src/xr/XrController.ts, simulator
 * scene). "Simular aquí" and "Volver al mapa del Perú" hand the running XRSession from one
 * experience to the other instead of ending it and requesting a new one.
 *
 * Why: `navigator.xr.requestSession('immersive-vr')` needs transient user activation in the
 * page (WebXR Device API, "requestSession" steps), and a controller `select` inside an
 * immersive session is not a page activation in every browser (the spec only lets the UA
 * treat it as one), so on the Quest Browser ending the map session and starting the
 * simulator's would at best flash back to the 2D page and at worst be refused. Keeping the
 * session alive avoids that entirely; only the experience that renders it changes.
 *
 * How: Babylon's session manager is bound to one scene, so each experience keeps its own
 * session manager, camera, controllers and features. The second experience "adopts" the
 * session through its normal enterXRAsync with `requestSession` answered by the running
 * session; afterwards switching restores the owner's render state (its XRWebGLLayer or
 * projection layers), re-attaches its features and restarts its XR render loop, while the
 * other experience's features are detached and its frame callback is cancelled. This relies
 * on Babylon internals (`_xrNavigator`, `_frameHandler`, `_addAndRemoveControllers`) of
 * @babylonjs/core 9.31, checked against its sources; it is not verified on a Quest yet.
 */
export class SharedXrSession {
  private session: XRSession | null = null;
  private mode: XRSessionMode | null = null;
  private owner: XrSessionMember | null = null;
  private readonly members = new Map<XrSessionMember, { renderState: XRRenderStateInit | null; detached: string[] }>();
  private switching = false;

  constructor(
    private readonly engine: AbstractEngine,
    /** Runs the app's render loop again (after a shared session ended). */
    private readonly restartLoop: () => void,
    /** The session ended (headset exit, "Salir de VR", B). */
    private readonly onEnd: () => void,
  ) {}

  get sessionMode(): XRSessionMode | null {
    return this.mode;
  }

  get busy(): boolean {
    return this.switching;
  }

  /** An experience entered a new session of its own (web "Entrar en VR/AR"). */
  started(xr: XrSessionMember, mode: XRSessionMode): void {
    const session = xr.baseExperience.sessionManager.session;
    this.session = session;
    this.mode = mode;
    this.owner = xr;
    this.members.clear();
    this.members.set(xr, { renderState: null, detached: [] });
    session.addEventListener('end', () => this.ended(session), { once: true });
  }

  owns(xr: XrSessionMember | null | undefined): boolean {
    return !!xr && this.owner === xr;
  }

  /**
   * Moves the session to `to`. `enter` is `to`'s usual enterXRAsync call, used the first time
   * `to` joins this session; `swap` runs while neither experience renders (switch the scene
   * the app draws there) and `revert` undoes it if the hand-over fails.
   */
  async handover(to: XrSessionMember, enter: () => Promise<void>, swap: () => void, revert: () => void): Promise<void> {
    const session = this.session;
    const from = this.owner;
    if (!session || !from) throw new Error('No hay una sesión de VR activa');
    if (from === to) return;
    if (this.switching) throw new Error('Cambio de vista en curso');
    this.switching = true;
    let swapped = false;
    const own = this.members.get(from)!;
    try {
      // Out of any XR frame callback: the press that asked for this ran inside one.
      await new Promise((r) => setTimeout(r, 0));
      if (this.session !== session) throw new Error('La sesión de VR terminó');
      own.renderState = renderStateOf(session);
      own.detached = suspendFeatures(from);
      this.stopLoop(session);
      swap();
      swapped = true;
      const joined = this.members.get(to);
      if (joined) {
        if (joined.renderState) session.updateRenderState(joined.renderState);
        resumeFeatures(to, joined.detached);
        to.baseExperience.sessionManager.runXRRenderLoop();
      } else {
        this.members.set(to, { renderState: null, detached: [] });
        await adopt(to, session, enter);
      }
      this.owner = to;
    } catch (err) {
      // Babylon ends the session when an enterXRAsync fails after requestSession; otherwise
      // the previous owner takes the session back.
      this.members.delete(to);
      if (swapped) revert();
      if (this.session === session) {
        try {
          if (own.renderState) session.updateRenderState(own.renderState);
          resumeFeatures(from, own.detached);
          from.baseExperience.sessionManager.runXRRenderLoop();
        } catch {
          // The session is ending: its 'end' handler restores the web.
        }
      }
      throw err;
    } finally {
      this.switching = false;
    }
  }

  /** The viewer closes: ends the running session (its 'end' handler restores the web). */
  dispose(): void {
    this.session?.end().catch(() => undefined);
  }

  /** Cancels the pending XR frame of the current owner so exactly one frame loop runs. */
  private stopLoop(session: XRSession): void {
    const engine = this.engine as unknown as { customAnimationFrameRequester: { requestID?: number } | null; _frameHandler: number };
    const req = engine.customAnimationFrameRequester;
    if (req?.requestID !== undefined) session.cancelAnimationFrame(req.requestID);
    engine._frameHandler = 0;
  }

  private ended(session: XRSession): void {
    if (session !== this.session) return;
    const shared = this.members.size > 1;
    this.session = null;
    this.mode = null;
    this.owner = null;
    this.members.clear();
    this.onEnd();
    if (!shared) return;
    // Every session manager of the session restarts the window render loop when it ends and
    // restores the canvas size it saw on entering: keep a single loop and re-measure.
    this.engine.stopRenderLoop();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.engine.resize();
      this.restartLoop();
    }));
  }
}

/** First join: `to`'s enterXRAsync with requestSession answered by the running session. */
async function adopt(to: XrSessionMember, session: XRSession, enter: () => Promise<void>): Promise<void> {
  const sm = to.baseExperience.sessionManager as unknown as { _xrNavigator: unknown };
  const real = sm._xrNavigator;
  sm._xrNavigator = { xr: { requestSession: async () => session, isSessionSupported: async () => true } };
  try {
    await enter();
  } finally {
    sm._xrNavigator = real;
  }
  // Babylon adds controllers on 'inputsourceschange', which fired before this experience joined.
  const input = to.input as unknown as { _addAndRemoveControllers(add: XRInputSource[], remove: XRInputSource[]): void };
  input._addAndRemoveControllers(Array.from(session.inputSources), []);
}

function renderStateOf(session: XRSession): XRRenderStateInit {
  const r = session.renderState as XRRenderState & { layers?: readonly unknown[] };
  const init: XRRenderStateInit & { layers?: unknown[] } = { depthNear: r.depthNear, depthFar: r.depthFar };
  if (r.layers?.length) init.layers = [...r.layers];
  else if (r.baseLayer) init.baseLayer = r.baseLayer;
  return init;
}

/** Detaches the features (pointer selection, teleportation…) of a paused experience; layers stay. */
function suspendFeatures(xr: XrSessionMember): string[] {
  const fm = xr.baseExperience.featuresManager;
  const names = fm.getEnabledFeatures().filter((n) => n !== WebXRFeatureName.LAYERS && (fm.getEnabledFeature(n as Parameters<typeof fm.getEnabledFeature>[0]) as { attached?: boolean } | undefined)?.attached);
  for (const n of names) fm.detachFeature(n);
  return names;
}

function resumeFeatures(xr: XrSessionMember, names: string[]): void {
  const fm = xr.baseExperience.featuresManager;
  for (const n of names) fm.attachFeature(n);
}
