/** What the switcher needs from a simulator mode (src/viewer/SimulatorMode.ts). */
export interface SwitchableMode {
  readonly id: string;
  show(): void;
  hide(): void;
  frame(): void;
  dispose(): void;
}

export interface SwitchableOverview {
  show(): void;
  hide(): void;
  render(): void;
}

/** 'overview' or the id of the mode on screen. */
export type ViewerScreen = string;

/**
 * Which screen the viewer shows: the Peru overview or exactly one simulator mode. The active
 * mode is the last one opened (the first by default); it alone renders and listens.
 */
export class ModeSwitcher<Mode extends SwitchableMode> {
  private current: Mode;
  private onOverview = false;
  private disposed = false;

  constructor(
    private readonly modes: readonly Mode[],
    private readonly overview: SwitchableOverview,
    private readonly onChange: (screen: ViewerScreen) => void,
  ) {
    const [first] = modes;
    if (!first) throw new Error('El visor necesita al menos un simulador');
    this.current = first;
  }

  get overviewActive(): boolean {
    return this.onOverview;
  }

  get active(): Mode {
    return this.current;
  }

  mode(id: string): Mode | undefined {
    return this.modes.find((mode) => mode.id === id);
  }

  /** False when the overview was already shown. */
  showOverview(): boolean {
    if (this.onOverview) return false;
    this.onOverview = true;
    this.current.hide();
    this.overview.show();
    this.onChange('overview');
    return true;
  }

  showMode(id: string): void {
    const next = this.mode(id);
    if (!next) throw new Error(`Simulador desconocido: ${id}`);
    if (!this.onOverview && next === this.current) return;
    if (this.onOverview) this.overview.hide();
    else this.current.hide();
    this.onOverview = false;
    this.current = next;
    next.show();
    this.onChange(id);
  }

  frame(): void {
    if (this.onOverview) this.overview.render();
    else this.current.frame();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mode of this.modes) mode.dispose();
  }
}
