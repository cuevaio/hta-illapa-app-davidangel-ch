/**
 * Automatic quality degradation. Fed with frame times, it escalates through
 * cheaper settings when the frame rate stays below target:
 *   1. render at lower resolution (hardware scaling),
 *   2. halve the solver substep budget (simulation runs slower than requested),
 *   3. step the solver profile down (one-off state resample).
 * It never upgrades on its own: oscillating between profiles is worse than a
 * stable, slightly lower quality.
 */
export type GovernorAction = 'none' | 'reduce-render-scale' | 'reduce-substeps' | 'step-down-profile';

export interface GovernorOptions {
  targetFps: number;
  /** Fraction of the target below which a window counts as slow. */
  tolerance?: number;
  /** Length of an evaluation window (ms). */
  windowMs?: number;
  /** Consecutive slow windows required before acting. */
  slowWindows?: number;
  /** Frames ignored after an action, while the new setting settles. */
  settleMs?: number;
}

export class FpsGovernor {
  level = 0;
  private readonly target: number;
  private readonly tolerance: number;
  private readonly windowMs: number;
  private readonly slowWindows: number;
  private readonly settleMs: number;
  private elapsed = 0;
  private frames = 0;
  private slowCount = 0;
  private settle = 0;
  lastFps = 0;

  constructor(o: GovernorOptions) {
    this.target = o.targetFps;
    this.tolerance = o.tolerance ?? 0.85;
    this.windowMs = o.windowMs ?? 1000;
    this.slowWindows = o.slowWindows ?? 3;
    this.settleMs = o.settleMs ?? 2000;
  }

  /** Resets escalation, e.g. after the user picks a profile by hand. */
  reset(): void {
    this.level = 0;
    this.elapsed = this.frames = this.slowCount = 0;
    this.settle = this.settleMs;
  }

  frame(frameMs: number): GovernorAction {
    if (this.settle > 0) {
      this.settle -= frameMs;
      return 'none';
    }
    this.elapsed += frameMs;
    this.frames++;
    if (this.elapsed < this.windowMs) return 'none';
    this.lastFps = (this.frames * 1000) / this.elapsed;
    this.elapsed = this.frames = 0;
    this.slowCount = this.lastFps < this.target * this.tolerance ? this.slowCount + 1 : 0;
    if (this.slowCount < this.slowWindows) return 'none';
    this.slowCount = 0;
    this.settle = this.settleMs;
    const actions: GovernorAction[] = ['reduce-render-scale', 'reduce-substeps', 'step-down-profile'];
    const action = actions[Math.min(this.level, actions.length - 1)];
    this.level++;
    return action;
  }
}
