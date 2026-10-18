import type { ToolId, XrViewMode } from '../state/appState';
import { pointLabel } from '../map/overviewState';
import type { VrView } from '../xr/vrMode';
import type { IconName } from './icons';

export interface PanelSections {
  /** Settings for new origins. */
  source: boolean;
  /** Barrier type and wall height. */
  wall: boolean;
  /** Maquette size, grid snap and ray smoothing. */
  maquette: boolean;
  /** One-line gesture help for tools without settings. */
  hint: string | null;
}

/** Which panel parts are shown (3D and web): only the options of the active tool and mode. */
export function panelSections(s: { tool: ToolId; mode: XrViewMode; input?: 'xr' | 'web' }): PanelSections {
  const hints: Partial<Record<ToolId, string>> =
    s.input === 'web'
      ? {
          navigate: 'Arrastra para girar la cámara, clic derecho para desplazarla y la rueda para acercarte.',
          erase: 'Haz clic sobre un muro u origen para borrarlo.',
        }
      : {
          navigate: 'Mantén el grip para mover y girar la maqueta (con las dos manos, escalar). Joystick derecho: girar.',
          erase: 'Apunta a un muro u origen y aprieta el gatillo para borrarlo.',
        };
  return {
    source: s.tool === 'source',
    wall: s.tool === 'wall',
    maquette: s.mode === 'maquette',
    hint: hints[s.tool] ?? null,
  };
}

/** One button of a VR card or panel row. */
export interface CardAction {
  id: string;
  icon: IconName;
  text: string;
}

/** The VR "Simular aquí" card over the Peru map (src/ui/vr/VrPointCard.ts). */
export interface PointCardContent {
  visible: boolean;
  title: string;
  coords: string;
  /** Download progress or the last failure; null when idle. */
  status: string | null;
  simulate: boolean;
  cancel: boolean;
  actions: CardAction[];
  views: (CardAction & { active: boolean })[];
  /** Weather section (S8), null without a weather client. */
  weather: WeatherCardContent | null;
}

/** Weather part of the VR card: layer toggles, forecast time step and the values at the marked point. */
export interface WeatherCardContent {
  toggles: { id: string; text: string; active: boolean; disabled: boolean }[];
  /** "Pronóstico: 2026-10-18 09:00 UTC" (the ◀ ▶ step row), null without a forecast axis. */
  time: string | null;
  /** One line per enabled layer at the point, or the backend notice. */
  values: string[];
  /** Attribution of the enabled layers (always shown while one is on). */
  credit: string | null;
}

export function weatherCardContent(s: {
  backend: 'loading' | 'ready' | 'down';
  notice: string | null;
  layers: { id: string; title: string; enabled: boolean; disabled: boolean }[];
  timeLabel: string | null;
  lines: { id?: string; label: string; text: string }[];
  attribution: string | null;
}): WeatherCardContent {
  return {
    toggles: s.layers.map((l) => ({ id: `wx:${l.id}`, text: l.title, active: l.enabled, disabled: l.disabled })),
    time: s.backend === 'ready' && s.timeLabel ? `Pronóstico: ${s.timeLabel}` : null,
    values: s.notice ? [s.notice] : s.lines.map((l) => `${l.label}: ${l.text}`),
    credit: s.attribution,
  };
}

export function pointCardContent(s: {
  picked: { lon: number; lat: number; height: number | null } | null;
  busy: boolean;
  error: string | null;
  view: VrView;
  weather?: WeatherCardContent | null;
}): PointCardContent {
  return {
    visible: s.picked !== null,
    title: 'Punto marcado',
    coords: s.picked ? pointLabel(s.picked) : '',
    status: s.busy ? 'Descargando el terreno real de la zona (z11)…' : s.error ? `No se pudo preparar la simulación: ${s.error}` : null,
    simulate: !!s.picked && !s.busy,
    cancel: !s.busy,
    actions: [
      { id: 'simulate', icon: 'play', text: 'Simular aquí' },
      { id: 'cancel', icon: 'close', text: 'Cancelar' },
    ],
    views: [
      { id: 'vuelo', icon: 'fly', text: 'Vuelo', active: s.view === 'vuelo' },
      { id: 'maqueta', icon: 'maquette', text: 'Maqueta', active: s.view === 'maqueta' },
    ],
    weather: s.weather ?? null,
  };
}

/** Last rows of the simulator VR panel: the way back to the Peru map (VR only) and "Salir de VR". */
export function panelFooter(s: { backToMap: boolean }): CardAction[] {
  const exit: CardAction = { id: 'exit', icon: 'exit', text: 'Salir de VR' };
  return s.backToMap ? [{ id: 'backToMap', icon: 'map', text: 'Volver al mapa del Perú' }, exit] : [exit];
}
