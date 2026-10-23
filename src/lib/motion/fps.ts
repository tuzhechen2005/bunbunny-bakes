/**
 * Sustained low-frame-rate detector. Feed it one timestamp per animation frame; once the
 * measured fps stays under `thresholdFps` for `sustainMs`, `degraded` flips to true (sticky for
 * the session) and listeners fire. Gaps longer than `gapMs` (loop was asleep, tab hidden) are
 * not treated as slow frames: they restart the measurement window.
 */

export interface FpsMonitorOptions {
  thresholdFps?: number;
  /** How long fps must stay low before we degrade. */
  sustainMs?: number;
  /** Frames are averaged over windows of this length. */
  windowMs?: number;
  /** A frame gap above this restarts measurement. */
  gapMs?: number;
}

export class FpsMonitor {
  degraded = false;
  private readonly threshold: number;
  private readonly sustainMs: number;
  private readonly windowMs: number;
  private readonly gapMs: number;
  private last: number | null = null;
  private windowStart = 0;
  private frames = 0;
  private lowSince: number | null = null;
  private listeners = new Set<() => void>();

  constructor(opts: FpsMonitorOptions = {}) {
    this.threshold = opts.thresholdFps ?? 45;
    this.sustainMs = opts.sustainMs ?? 1500;
    this.windowMs = opts.windowMs ?? 500;
    this.gapMs = opts.gapMs ?? 250;
  }

  /** Call once per animation frame with a monotonic timestamp in ms. */
  frame(now: number): void {
    if (this.degraded) return;
    if (this.last === null || now - this.last > this.gapMs) {
      this.restart(now);
      return;
    }
    this.last = now;
    this.frames++;
    const span = now - this.windowStart;
    if (span < this.windowMs) return;
    const fps = (this.frames * 1000) / span;
    const lowStart = this.windowStart;
    this.windowStart = now;
    this.frames = 0;
    if (fps >= this.threshold) {
      this.lowSince = null;
      return;
    }
    this.lowSince ??= lowStart;
    if (now - this.lowSince >= this.sustainMs) {
      this.degraded = true;
      this.listeners.forEach((l) => l());
    }
  }

  /** Forget the current window (call when the loop wakes after resting). */
  restart(now: number | null = null): void {
    this.last = now;
    this.windowStart = now ?? 0;
    this.frames = 0;
    this.lowSince = null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Forget the sticky degraded flag (tests, dev tools). */
  reset(): void {
    this.degraded = false;
    this.restart();
    this.listeners.forEach((l) => l());
  }
}

/** Shared monitor fed by every motion loop (see loop.ts) and read by useMotionPrefs(). */
export const motionHealth = new FpsMonitor();
