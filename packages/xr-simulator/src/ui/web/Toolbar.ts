import type { AppState, ToolId } from '../../state/appState';
import type { Store } from '../../state/store';
import { iconSvg, type IconName } from '../icons';

const TOOLS: { id: ToolId & IconName; label: string; key: string; title: string }[] = [
  { id: 'navigate', label: 'Navegar', key: 'N', title: 'Orbitar y hacer zoom (N)' },
  { id: 'source', label: 'Origen', key: 'O', title: 'Colocar el origen del huaico (O)' },
  { id: 'wall', label: 'Muro', key: 'M', title: 'Dibujar un muro de contención (M)' },
  { id: 'erase', label: 'Borrar', key: 'B', title: 'Borrar un muro (B)' },
];

export interface ToolbarActions {
  undo(): void;
  redo(): void;
}

/** Floating tool switcher with undo/redo; big touch targets, bound to the shared store. */
export class Toolbar {
  constructor(container: HTMLElement, store: Store<AppState>, actions: ToolbarActions) {
    const bar = document.createElement('div');
    bar.className = 'toolbar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Herramientas de edición');
    const buttons = new Map<ToolId, HTMLButtonElement>();
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `${iconSvg(t.id)}<span>${t.label}</span>`;
      b.title = t.title;
      b.setAttribute('aria-label', t.label);
      b.setAttribute('aria-pressed', 'false');
      b.onclick = () => store.set({ tool: t.id });
      buttons.set(t.id, b);
      bar.append(b);
    }
    const sep = document.createElement('span');
    sep.className = 'sep';
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.innerHTML = iconSvg('undo');
    undoBtn.title = 'Deshacer (Ctrl+Z)';
    undoBtn.setAttribute('aria-label', 'Deshacer');
    undoBtn.onclick = actions.undo;
    const redoBtn = document.createElement('button');
    redoBtn.type = 'button';
    redoBtn.innerHTML = iconSvg('redo');
    redoBtn.title = 'Rehacer (Ctrl+Y)';
    redoBtn.setAttribute('aria-label', 'Rehacer');
    redoBtn.onclick = actions.redo;
    bar.append(sep, undoBtn, redoBtn);
    container.append(bar);

    const sync = (s: AppState) => {
      for (const [id, b] of buttons) {
        b.classList.toggle('active', s.tool === id);
        b.setAttribute('aria-pressed', String(s.tool === id));
      }
      undoBtn.disabled = s.history.commands.length === 0;
      redoBtn.disabled = s.history.redo.length === 0;
    };
    sync(store.get());
    store.subscribe(sync);
  }
}
