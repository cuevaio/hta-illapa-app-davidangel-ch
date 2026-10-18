import { UniversalCamera, Vector3, type Scene } from '@babylonjs/core';
import { clampAltitude, clampToBounds, FLY, flyVelocity, type Bounds, type FlyInput } from './flight';

const KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);
const LOOK_RAD_PER_PX = 0.004;
const PITCH_LIMIT = 1.5;

export interface FlyGround {
  /** Exaggerated ground height (scene km) under (x, z). */
  groundAt(x: number, z: number): number;
  bounds(): Bounds;
}

/**
 * Web "Vuelo libre" over the overview, like peru-simulator's FlyControls: WASD move, Q/E
 * down/up, Shift boost, drag to look. Touch: drag to look plus hold buttons (fly pad).
 */
export class OverviewFly {
  readonly camera: UniversalCamera;
  enabled = false;
  private readonly pressed = new Set<string>();
  private drag: { id: number; x: number; y: number } | null = null;

  constructor(scene: Scene, private readonly canvas: HTMLCanvasElement, private readonly ground: FlyGround) {
    this.camera = new UniversalCamera('peru-fly', new Vector3(0, 500, -1500), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.05;
    this.camera.maxZ = 20_000;
    this.camera.fov = 1;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  /** Places the camera at `eye` looking towards `target`. */
  lookFrom(eye: Vector3, target: Vector3): void {
    const d = target.subtract(eye).normalize();
    this.camera.position.copyFrom(eye);
    this.camera.rotation.set(Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, -Math.asin(d.y))), Math.atan2(d.x, d.z), 0);
    this.clamp();
  }

  /** Hold-button input from the on-screen pad (touch). */
  hold(code: string, down: boolean): void {
    if (down) this.pressed.add(code);
    else this.pressed.delete(code);
  }

  update(dtSeconds: number): void {
    if (!this.enabled) return;
    const p = this.camera.position;
    const k = (a: string, b: string) => (this.pressed.has(a) ? 1 : 0) - (this.pressed.has(b) ? 1 : 0);
    const input: FlyInput = {
      forward: k('KeyW', 'KeyS'),
      strafe: k('KeyD', 'KeyA'),
      vertical: k('KeyE', 'KeyQ'),
      boost: this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight'),
    };
    const agl = p.y - this.ground.groundAt(p.x, p.z);
    const v = flyVelocity(input, this.camera.rotation.y, agl);
    const dt = Math.min(dtSeconds, 0.1);
    p.set(p.x + v[0] * dt, p.y + v[1] * dt, p.z + v[2] * dt);
    this.clamp();
  }

  private clamp(): void {
    const p = this.camera.position;
    const [x, z] = clampToBounds(p.x, p.z, this.ground.bounds());
    // groundAt is already exaggerated: exaggeration 1 here.
    p.set(x, clampAltitude(p.y, this.ground.groundAt(x, z), 1, FLY.clearance, FLY.maxAltitude), z);
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
    if (KEYS.has(e.code)) {
      this.pressed.add(e.code);
      e.preventDefault();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent) => this.pressed.delete(e.code);

  private readonly onBlur = () => this.pressed.clear();

  private readonly onPointerDown = (e: PointerEvent) => {
    if (this.enabled && e.button === 0 && !this.drag) this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!this.enabled || !d || d.id !== e.pointerId) return;
    const r = this.camera.rotation;
    r.y += (e.clientX - d.x) * LOOK_RAD_PER_PX;
    r.x = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, r.x + (e.clientY - d.y) * LOOK_RAD_PER_PX));
    d.x = e.clientX;
    d.y = e.clientY;
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    if (this.drag?.id === e.pointerId) this.drag = null;
  };

  /** Clears held keys (mode switch, VR). */
  release(): void {
    this.pressed.clear();
    this.drag = null;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }
}
