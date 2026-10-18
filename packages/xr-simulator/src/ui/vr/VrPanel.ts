import { MeshBuilder, type Mesh, type Scene } from '@babylonjs/core';
import { AdvancedDynamicTexture, Button, Control, Grid, Image, Slider, StackPanel, TextBlock } from '@babylonjs/gui';
import { redo as redoHistory, undo as undoHistory } from '../../edit/commands';
import { WALL_DEFAULTS, type AppState, type ToolId, type XrViewMode } from '../../state/appState';
import type { Store } from '../../state/store';
import type { SolverStats } from '../../solver/Solver';
import { iconDataUrl, type IconName } from '../icons';
import { panelFooter, panelSections } from '../sections';
import type { ResultActions } from '../../playback/ResultActions';

export interface VrPanelActions {
  resetSimulation(): void;
  exitXr(): void;
  result: ResultActions;
  /** "Volver al mapa del Perú" (S2), VR sessions only; absent: no such button. */
  backToMap?: () => void;
  /** Whether the map can be shown right now (its relief loaded). */
  mapAvailable?: () => boolean;
}

const PANEL_W = 0.5;
const PANEL_H = 0.9;
const TEX_W = 1000;
const TEX_H = 1800;
const ACCENT = '#e8913a';
const BUTTON_BG = '#2a3038';
const MUTED = '#9aa4b1';

interface ButtonSpec {
  icon: IconName | ((s: AppState) => IconName);
  text: string;
  onClick: () => void;
  active?: (s: AppState) => boolean;
  disabled?: (s: AppState) => boolean;
}

/**
 * Floating 3D panel for XR: a mesh with a GUI texture, operated with the controller ray
 * (Babylon pointer selection). It reads and writes the same store as the HTML panel. Only the
 * options of the active tool and mode are shown; every action has an icon.
 */
export class VrPanel {
  readonly mesh: Mesh;
  private readonly ui: AdvancedDynamicTexture;
  private readonly stats: TextBlock;
  private readonly unsubscribe: () => void;
  private readonly syncers: ((s: AppState) => void)[] = [];

  constructor(scene: Scene, private readonly store: Store<AppState>, actions: VrPanelActions) {
    this.mesh = MeshBuilder.CreatePlane('vr-panel', { width: PANEL_W, height: PANEL_H, sideOrientation: 2 }, scene);
    this.mesh.isPickable = true;
    this.ui = AdvancedDynamicTexture.CreateForMesh(this.mesh, TEX_W, TEX_H, false);
    this.ui.background = 'rgba(15,18,22,0.92)';

    const root = new StackPanel('root');
    root.width = '94%';
    root.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    root.paddingTop = '20px';
    this.ui.addControl(root);

    root.addControl(this.label('Simulador de huaicos', 50, 'white', true));
    this.stats = this.label('', 28, MUTED);
    this.stats.height = '90px';
    root.addControl(this.stats);

    // Tools.
    const tool = (id: ToolId, icon: IconName, text: string): ButtonSpec => ({ icon, text, active: (s) => s.tool === id, onClick: () => store.set({ tool: id }) });
    root.addControl(this.row('Herramienta', [
      tool('navigate', 'navigate', 'Navegar'),
      tool('source', 'source', 'Origen'),
      tool('wall', 'wall', 'Muro'),
      tool('erase', 'erase', 'Borrar'),
    ]));

    // Options of the active tool.
    const hint = this.label('', 30, MUTED);
    hint.height = '96px';
    root.addControl(hint);
    const sourceBox = this.section(root);
    sourceBox.addControl(this.label('Orígenes nuevos', 32, ACCENT));
    sourceBox.addControl(this.slider('Volumen (m³)', 1000, 500_000, 1000, (s) => s.emitter.volume, (v) => store.set((s) => ({ emitter: { ...s.emitter, volume: v } })), (v) => v.toFixed(0)));
    sourceBox.addControl(this.slider('Caudal pico (m³/s)', 10, 2000, 10, (s) => s.emitter.peakDischarge, (v) => store.set((s) => ({ emitter: { ...s.emitter, peakDischarge: v } })), (v) => v.toFixed(0)));
    sourceBox.addControl(this.slider('Radio (m)', 5, 100, 1, (s) => s.emitter.radius, (v) => store.set((s) => ({ emitter: { ...s.emitter, radius: v } })), (v) => v.toFixed(0)));
    const wallBox = this.section(root);
    const material = (m: 'earth' | 'concrete', icon: IconName, text: string): ButtonSpec => ({
      icon, text,
      active: (s) => s.wall.material === m,
      onClick: () => store.set((s) => ({ wall: { ...s.wall, material: m, ...WALL_DEFAULTS[m] } })),
    });
    wallBox.addControl(this.row('Tipo de barrera', [material('earth', 'earth', 'Berma de tierra'), material('concrete', 'concrete', 'Concreto')]));
    wallBox.addControl(this.slider('Altura del muro (m)', 1, 30, 0.5, (s) => s.wall.height, (v) => store.set((s) => ({ wall: { ...s.wall, height: v } })), (v) => v.toFixed(1)));

    // Simulation.
    root.addControl(this.row('Simulación', [
      {
        icon: (s) => (s.playback.playing ? 'pause' : 'play'),
        text: '',
        active: (s) => s.playback.playing,
        onClick: () => store.set((s) => ({ playback: { ...s.playback, playing: !s.playback.playing } })),
      },
      { icon: 'reset', text: 'Reiniciar', onClick: actions.resetSimulation },
      { icon: 'undo', text: '', onClick: () => store.set((s) => ({ history: undoHistory(s.history) })), disabled: (s) => s.history.commands.length === 0 },
      { icon: 'redo', text: '', onClick: () => store.set((s) => ({ history: redoHistory(s.history) })), disabled: (s) => s.history.redo.length === 0 },
    ]));
    root.addControl(this.slider('Velocidad (× tiempo real)', 1, 60, 1, (s) => s.playback.speed, (v) => store.set((s) => ({ playback: { ...s.playback, speed: v } })), (v) => v.toFixed(0)));
    root.addControl(this.slider('Fricción μ', 0.02, 0.5, 0.01, (s) => s.material.mu, (v) => store.set((s) => ({ material: { ...s.material, mu: v } }))));

    // Recording and result mode (same actions as the web timeline).
    const ra = actions.result;
    const liveRow = this.row('Resultado', [
      {
        icon: (s) => (s.result.recording ? 'stop' : 'record'),
        text: '',
        active: (s) => s.result.recording,
        onClick: () => ra.toggleRecording(),
      },
      { icon: 'result', text: 'Ver resultado', onClick: () => ra.setResultMode(true), disabled: (s) => s.result.frames < 2 },
    ]);
    root.addControl(liveRow);
    const resultBox = this.section(root);
    resultBox.addControl(this.row('Resultado', [
      { icon: 'stepBack', text: '', onClick: () => ra.step(-1) },
      { icon: (s) => (s.result.playing ? 'pause' : 'play'), text: '', active: (s) => s.result.playing, onClick: () => ra.togglePlay() },
      { icon: 'stepForward', text: '', onClick: () => ra.step(1) },
      { icon: 'live', text: 'Vivo', onClick: () => ra.setResultMode(false) },
    ]));
    resultBox.addControl(this.timeSlider(ra));

    // View.
    const mode = (m: XrViewMode, icon: IconName, text: string): ButtonSpec => ({ icon, text, active: (s) => s.xr.mode === m, onClick: () => store.set((s) => ({ xr: { ...s.xr, mode: m } })) });
    root.addControl(this.row('Vista', [mode('maquette', 'maquette', 'Maqueta'), mode('immersive', 'immersive', 'Inmersivo')]));
    const maquetteBox = this.section(root);
    maquetteBox.addControl(this.slider('Tamaño de la maqueta (m)', 0.2, 6, 0.1, (s) => s.xr.tableSize, (v) => store.set((s) => ({ xr: { ...s.xr, tableSize: v } })), (v) => v.toFixed(1)));
    maquetteBox.addControl(this.slider('Ajuste a cuadrícula (m, 0 = no)', 0, 50, 5, (s) => s.xr.snap, (v) => store.set((s) => ({ xr: { ...s.xr, snap: v } })), (v) => v.toFixed(0)));
    maquetteBox.addControl(this.slider('Suavizado del rayo', 0, 0.9, 0.05, (s) => s.xr.smoothing, (v) => store.set((s) => ({ xr: { ...s.xr, smoothing: v } }))));

    // Footer: "Volver al mapa del Perú" (staying in VR) when offered, then "Salir de VR".
    // One row, so the panel keeps its height.
    root.addControl(this.row('', panelFooter({ backToMap: !!actions.backToMap }).map((a): ButtonSpec => a.id === 'backToMap'
      ? { icon: a.icon, text: a.text, onClick: () => actions.backToMap?.(), disabled: () => !(actions.mapAvailable?.() ?? true) }
      : { icon: a.icon, text: a.text, onClick: actions.exitXr })));

    this.syncers.push((s) => {
      const sec = panelSections({ tool: s.tool, mode: s.xr.mode });
      sourceBox.isVisible = sec.source;
      wallBox.isVisible = sec.wall;
      maquetteBox.isVisible = sec.maquette;
      const inResult = s.result.mode === 'result';
      liveRow.isVisible = !inResult;
      resultBox.isVisible = inResult;
      hint.isVisible = sec.hint !== null;
      hint.text = sec.hint ?? '';
    });
    const sync = (s: AppState) => this.syncers.forEach((f) => f(s));
    sync(store.get());
    this.unsubscribe = store.subscribe(sync);
  }

  private section(parent: StackPanel): StackPanel {
    const box = new StackPanel();
    box.width = '100%';
    parent.addControl(box);
    return box;
  }

  private label(text: string, size: number, color = 'white', bold = false): TextBlock {
    const t = new TextBlock(undefined, text);
    t.color = color;
    t.fontSize = size;
    t.fontWeight = bold ? 'bold' : 'normal';
    t.height = `${Math.round(size * 1.6)}px`;
    t.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    t.textWrapping = true;
    return t;
  }

  /** A titled row of icon buttons. */
  private row(title: string, items: ButtonSpec[]): StackPanel {
    const box = new StackPanel();
    box.width = '100%';
    if (title) box.addControl(this.label(title, 30, MUTED));
    const grid = new Grid();
    grid.height = '112px';
    items.forEach(() => grid.addColumnDefinition(1 / items.length));
    items.forEach((it, k) => grid.addControl(this.button(it, items.length >= 4 ? 26 : 30), 0, k));
    box.addControl(grid);
    return box;
  }

  private button(it: ButtonSpec, fontSize: number): Button {
    const b = new Button();
    b.background = BUTTON_BG;
    b.cornerRadius = 14;
    b.thickness = 0;
    b.paddingLeft = b.paddingRight = '6px';
    b.paddingTop = b.paddingBottom = '8px';
    // Fixed grid inside the button: the icon cell has a bounded size and the label clips with an
    // ellipsis, so neither can overflow the button whatever the device font measures.
    const content = new Grid();
    const ICON = 56;
    if (it.text) {
      content.addColumnDefinition(ICON + 20, true);
      content.addColumnDefinition(1);
    } else {
      content.addColumnDefinition(1);
    }
    const img = new Image();
    img.width = `${ICON}px`;
    img.height = `${ICON}px`;
    img.stretch = Image.STRETCH_UNIFORM;
    img.horizontalAlignment = it.text ? Control.HORIZONTAL_ALIGNMENT_RIGHT : Control.HORIZONTAL_ALIGNMENT_CENTER;
    content.addControl(img, 0, 0);
    let text: TextBlock | null = null;
    if (it.text) {
      text = new TextBlock(undefined, it.text);
      text.fontSize = fontSize;
      text.paddingLeft = '12px';
      text.paddingRight = '8px';
      text.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
      text.textWrapping = 2; // TextWrapping.Ellipsis (ambient const enum)
      content.addControl(text, 0, 1);
    }
    b.addControl(content);
    b.onPointerClickObservable.add(() => {
      if (b.isEnabled) it.onClick();
    });
    let lastSrc = '';
    this.syncers.push((s) => {
      const active = it.active?.(s) ?? false;
      const color = active ? '#111111' : '#ffffff';
      b.background = active ? ACCENT : BUTTON_BG;
      if (text) text.color = color;
      const name = typeof it.icon === 'function' ? it.icon(s) : it.icon;
      const src = iconDataUrl(name, color);
      if (src !== lastSrc) {
        img.source = src;
        lastSrc = src;
      }
      const off = it.disabled?.(s) ?? false;
      b.isEnabled = !off;
      b.alpha = off ? 0.35 : 1;
    });
    return b;
  }

  private slider(title: string, min: number, max: number, step: number, get: (s: AppState) => number, set: (v: number) => void, fmt = (v: number) => v.toFixed(2)): StackPanel {
    const box = new StackPanel();
    box.width = '100%';
    const text = this.label('', 30);
    box.addControl(text);
    const sl = new Slider();
    sl.minimum = min;
    sl.maximum = max;
    sl.step = step;
    sl.height = '52px';
    sl.width = '92%';
    sl.color = ACCENT;
    sl.background = BUTTON_BG;
    sl.thumbWidth = '44px';
    sl.isThumbCircle = true;
    sl.onValueChangedObservable.add((v) => {
      if (Math.abs(v - get(this.store.get())) > step / 2) set(v);
    });
    box.addControl(sl);
    this.syncers.push((s) => {
      const v = get(s);
      if (Math.abs(sl.value - v) > step / 2) sl.value = v;
      text.text = `${title}: ${fmt(v)}`;
    });
    return box;
  }

  /** Playhead slider; its range follows the recording. */
  private timeSlider(ra: ResultActions): StackPanel {
    const box = new StackPanel();
    box.width = '100%';
    const text = this.label('', 30);
    box.addControl(text);
    const sl = new Slider();
    sl.height = '52px';
    sl.width = '92%';
    sl.color = ACCENT;
    sl.background = BUTTON_BG;
    sl.thumbWidth = '44px';
    sl.isThumbCircle = true;
    sl.onValueChangedObservable.add((v) => {
      if (Math.abs(v - this.store.get().result.time) > 0.5) ra.seek(v);
    });
    box.addControl(sl);
    this.syncers.push((s) => {
      const r = s.result;
      sl.minimum = r.start;
      sl.maximum = Math.max(r.end, r.start + 1);
      if (Math.abs(sl.value - r.time) > 0.5) sl.value = r.time;
      text.text = `Tiempo: ${r.time.toFixed(0)} / ${r.end.toFixed(0)} s (${r.frames} fotogramas)`;
    });
    return box;
  }

  setStats(s: SolverStats, massError: number): void {
    this.stats.text =
      `t = ${s.simTime.toFixed(0)} s · volumen ${s.volume.toFixed(0)} m³\n` +
      `error de masa ${(massError * 100).toExponential(1)} % · h máx ${s.maxDepth.toFixed(2)} m`;
  }

  dispose(): void {
    this.unsubscribe();
    this.ui.dispose();
    this.mesh.dispose();
  }
}
