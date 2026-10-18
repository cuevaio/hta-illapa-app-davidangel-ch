import { decodeRequestToTile, type DecodeResponse } from './decodeProtocol';
import type { PreparedTile } from './tileData';

const aborted = () => new DOMException('Aborted', 'AbortError');

/**
 * Pool of decode workers (after peru-simulator's decoder-pool.ts); PNG buffers are
 * transferred, never copied. Without module workers it decodes on the main thread.
 */
export class DecoderPool {
  private readonly workers: Worker[] = [];
  private readonly load: number[] = [];
  private readonly pending = new Map<number, { resolve: (t: PreparedTile) => void; reject: (e: unknown) => void; worker: number }>();
  private nextId = 1;

  constructor(size: number) {
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module', name: `peru-decode-${i}` });
        w.onmessage = (e: MessageEvent<DecodeResponse>) => this.onMessage(e.data);
        this.workers.push(w);
        this.load.push(0);
      }
    } catch (err) {
      console.warn('Sin workers de decodificación; se decodifica en el hilo principal', err);
      for (const w of this.workers) w.terminate();
      this.workers.length = 0;
    }
  }

  get size(): number {
    return this.workers.length;
  }

  decode(buffer: ArrayBuffer, segments: number, signal?: AbortSignal): Promise<PreparedTile> {
    if (signal?.aborted) return Promise.reject(aborted());
    const id = this.nextId++;
    if (!this.workers.length) return decodeRequestToTile({ id, buffer, segments });
    let worker = 0;
    for (let i = 1; i < this.load.length; i++) if (this.load[i] < this.load[worker]) worker = i;
    this.load[worker]++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, worker });
      // A worker cannot be interrupted mid-decode; an abort just discards the result.
      signal?.addEventListener('abort', () => reject(aborted()), { once: true });
      this.workers[worker].postMessage({ id, buffer, segments }, [buffer]);
    });
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Decodificador cerrado'));
    this.pending.clear();
  }

  private onMessage(r: DecodeResponse): void {
    const p = this.pending.get(r.id);
    if (!p) return;
    this.pending.delete(r.id);
    this.load[p.worker]--;
    if (r.ok) p.resolve(r.tile);
    else p.reject(new Error(r.error));
  }
}
