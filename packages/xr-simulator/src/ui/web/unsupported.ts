import type { CapabilityReport } from '../../platform/capabilities';

export const SUPPORTED_BROWSERS = [
  'Chrome 113+ o Edge 113+ en Windows, macOS y ChromeOS',
  'Chrome 121+ en Android 12+ (GPU Qualcomm/ARM)',
  'Safari 26+ en macOS, iOS y iPadOS',
  'Firefox 141+ en Windows',
  'Navegador de Meta Quest (versión reciente)',
];

function reason(report: CapabilityReport): string {
  if (report.gpu.error) return report.gpu.error;
  if (!report.gpu.apiPresent) {
    return window.isSecureContext
      ? 'Este navegador no expone WebGPU (navigator.gpu no existe).'
      : 'WebGPU solo está disponible en contextos seguros (HTTPS o localhost).';
  }
  return 'No se encontró un adaptador WebGPU compatible.';
}

/** Explains why the GPU solver cannot run. Never leaves the page blank. */
/** Info notice: WebGPU works, but VR in this browser needs WebGL, so the app started on WebGL2 + CPU. */
export function renderXrCompatNotice(container: HTMLElement): void {
  const box = document.createElement('section');
  box.className = 'notice notice-ok';
  box.setAttribute('role', 'status');
  box.innerHTML = `
    <h2>Modo compatible con VR</h2>
    <p>Este navegador ofrece realidad virtual pero no permite usar WebGPU dentro de la sesión
    (falta <code>XRGPUBinding</code>), así que la app arrancó con WebGL2 y el solver en CPU a 128×128.
    Para la simulación en GPU sin VR, abre la página con <code>?forcewebgpu</code>.</p>
    <button type="button" class="close">Entendido</button>`;
  box.querySelector<HTMLButtonElement>('.close')!.onclick = () => box.remove();
  container.prepend(box);
}

export function renderWebGpuUnavailable(container: HTMLElement, report: CapabilityReport, fallbackAvailable: boolean): void {
  const box = document.createElement('section');
  box.className = 'notice notice-error';
  box.setAttribute('role', 'alert');
  box.innerHTML = `
    <h2>WebGPU no está disponible</h2>
    <p class="reason"></p>
    <p>El simulador necesita WebGPU para ejecutar el solver en la GPU. Navegadores compatibles:</p>
    <ul>${SUPPORTED_BROWSERS.map((b) => `<li>${b}</li>`).join('')}</ul>
    <p class="fallback"></p>
    <p><a href="./diagnostics.html">Abrir el diagnóstico completo</a></p>
    <button type="button" class="close" hidden>Entendido</button>`;
  box.querySelector('.reason')!.textContent = reason(report);
  box.querySelector('.fallback')!.textContent = fallbackAvailable
    ? 'Se usará el solver alternativo en CPU con resolución reducida (128×128).'
    : 'El solver alternativo aún no está implementado en esta fase.';
  const close = box.querySelector<HTMLButtonElement>('.close')!;
  // With a working fallback the notice is informative only, so it can be dismissed.
  if (fallbackAvailable) {
    close.hidden = false;
    close.onclick = () => box.remove();
  }
  container.prepend(box);
}
