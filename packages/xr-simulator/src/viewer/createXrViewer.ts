import '../pages/app.css';
import './viewer.css';
import { HuaycoMode } from '../modes/huayco/HuaycoMode';
import type { ViewerScreen } from './ModeSwitcher';
import type { SimulatorMode, SimulatorModeFactory } from './SimulatorMode';
import { XrViewer, type XrViewerOptions } from './XrViewer';

export interface CreateXrViewerOptions extends Omit<XrViewerOptions, 'modes'> {
  /** Simulators added after the huayco one (e.g. the structures simulator of the host app). */
  modes?: SimulatorModeFactory[];
}

export interface XrViewerHandle {
  /** Settles once the viewer is built (or rejects when it cannot start). */
  readonly ready: Promise<void>;
  readonly viewer: XrViewer;
  activeScreen(): ViewerScreen | null;
  mode(id: string): SimulatorMode | undefined;
  /** The Peru map (ignored while a mode is in an immersive session). */
  showOverview(): void;
  /** Opens a mode at its own origin, from any screen. */
  openMode(id: string): Promise<void>;
  /** Stops rendering and releases the engine, listeners, XR session and DOM the viewer added. */
  dispose(): void;
}

/** Mounts the viewer (Peru map, weather, shared VR) with the huayco simulator plus `modes` into `container`. */
export function createXrViewer(container: HTMLElement, options: CreateXrViewerOptions = {}): XrViewerHandle {
  const viewer = new XrViewer(container, { ...options, modes: [(host) => new HuaycoMode(host), ...(options.modes ?? [])] });
  return {
    ready: viewer.start(),
    viewer,
    activeScreen: () => viewer.activeScreen,
    mode: (id) => viewer.mode(id),
    showOverview: () => viewer.backToMap(),
    openMode: async (id) => {
      const mode = viewer.mode(id);
      if (!mode) throw new Error(`Simulador desconocido: ${id}`);
      await mode.open(null);
    },
    dispose: () => viewer.dispose(),
  };
}
