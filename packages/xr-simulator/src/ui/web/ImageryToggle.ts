import { imageryCredit, type ImageryAvailability, type ImageryMode } from '../../map/imagery/imagerySource';

/** What the "Relieve / Satélite" switch shows (pure). */
export interface ImageryToggleState {
  mode: ImageryMode;
  satelliteDisabled: boolean;
  /** Why Satélite is disabled (Spanish), else null. */
  hint: string | null;
  /** Provider attribution, only while imagery is visible. */
  credit: string | null;
  /** Prototype-mode notice, only while imagery is visible. */
  notice: string | null;
}

export function imageryToggleState(availability: ImageryAvailability, mode: ImageryMode, attribution?: string): ImageryToggleState {
  if (!availability.available) return { mode: 'relief', satelliteDisabled: true, hint: availability.hint, credit: null, notice: null };
  if (mode === 'relief') return { mode, satelliteDisabled: false, hint: null, credit: null, notice: null };
  const c = imageryCredit(availability.source, attribution);
  return { mode, satelliteDisabled: false, hint: null, credit: c.text, notice: c.notice };
}

/** Initial shading: Satélite when a provider is configured (including the keyless prototype), else Relieve. */
export function defaultImageryMode(availability: ImageryAvailability): ImageryMode {
  return availability.available ? 'satellite' : 'relief';
}

/**
 * "Relieve / Satélite" segmented switch with its hint, attribution and prototype notice.
 * Used in the Peru overview overlay and over the simulator's map context.
 */
export class ImageryToggle {
  readonly el: HTMLElement;
  private readonly buttons: HTMLButtonElement[];
  private readonly hint: HTMLElement;
  private readonly credit: HTMLElement;
  private readonly notice: HTMLElement;
  private mode: ImageryMode;
  private attribution: string | undefined;

  constructor(private readonly availability: ImageryAvailability, mode: ImageryMode, private readonly onChange: (mode: ImageryMode) => void, className = '') {
    this.mode = mode;
    this.el = document.createElement('div');
    this.el.className = `imagery-toggle ${className}`.trim();
    this.el.innerHTML = `
      <div class="peru-mode" role="group" aria-label="Vista del terreno">
        <button type="button" data-imagery="relief" aria-pressed="false">Relieve</button>
        <button type="button" data-imagery="satellite" aria-pressed="false">Satélite</button>
      </div>
      <p class="imagery-hint" hidden></p>
      <p class="imagery-credit" hidden></p>
      <p class="imagery-notice" role="note" hidden></p>`;
    this.buttons = [...this.el.querySelectorAll<HTMLButtonElement>('button')];
    this.hint = this.el.querySelector('.imagery-hint')!;
    this.credit = this.el.querySelector('.imagery-credit')!;
    this.notice = this.el.querySelector('.imagery-notice')!;
    for (const b of this.buttons) {
      b.onclick = () => {
        const next = b.dataset.imagery as ImageryMode;
        if (next === this.mode || b.disabled) return;
        this.set(next);
        this.onChange(next);
      };
    }
    this.render();
  }

  get state(): ImageryToggleState {
    return imageryToggleState(this.availability, this.mode, this.attribution);
  }

  set(mode: ImageryMode): void {
    this.mode = mode;
    this.render();
  }

  /** Dynamic attribution from the provider (replaces the static text). */
  setAttribution(text: string): void {
    this.attribution = text;
    this.render();
  }

  private render(): void {
    const s = this.state;
    for (const b of this.buttons) {
      b.setAttribute('aria-pressed', String(b.dataset.imagery === s.mode));
      if (b.dataset.imagery === 'satellite') {
        b.disabled = s.satelliteDisabled;
        b.title = s.hint ?? '';
      }
    }
    this.hint.textContent = s.hint ?? '';
    this.hint.hidden = !s.hint;
    this.credit.textContent = s.credit ?? '';
    this.credit.hidden = !s.credit;
    this.notice.textContent = s.notice ?? '';
    this.notice.hidden = !s.notice;
  }
}
