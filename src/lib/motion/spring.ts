/**
 * Critically damped position spring, integrated with a fixed 1/240 s substep so the result is
 * the same at 60 Hz and 120 Hz (leftover time is carried over, never rounded away).
 * Pure TS, no React, no DOM. Units are caller-defined (px, item index, ...).
 */

/** Fixed integration step in seconds. */
export const SUBSTEP = 1 / 240;

export interface SpringConfig {
  /** Natural frequency in Hz. */
  frequencyHz: number;
  /** 1 = critically damped. */
  dampingRatio: number;
}

/** Rope position spring from FRONTEND.md section 5. */
export const ROPE_SPRING: SpringConfig = { frequencyHz: 1.7, dampingRatio: 0.9 };

const EPS_X = 1e-3;
const EPS_V = 1e-2;

export class Spring {
  x: number;
  v = 0;
  target: number;
  private acc = 0;

  constructor(
    initial = 0,
    readonly config: SpringConfig = ROPE_SPRING,
  ) {
    this.x = initial;
    this.target = initial;
  }

  /** Advance by `dt` seconds (any size); returns the new position. */
  step(dt: number): number {
    const { frequencyHz, dampingRatio } = this.config;
    const w = 2 * Math.PI * frequencyHz;
    this.acc += Math.max(0, dt);
    // The small epsilon absorbs float error so 1/60 s is exactly 4 substeps.
    while (this.acc >= SUBSTEP - 1e-9) {
      const a = w * w * (this.target - this.x) - 2 * dampingRatio * w * this.v;
      this.v += a * SUBSTEP;
      this.x += this.v * SUBSTEP;
      this.acc -= SUBSTEP;
    }
    if (this.acc < 0) this.acc = 0;
    return this.x;
  }

  /** Jump to a position with a given velocity (e.g. while a finger drags). */
  set(x: number, v = 0): void {
    this.x = x;
    this.v = v;
    this.acc = 0;
  }

  /** `epsX` / `epsV` loosen the rest test (e.g. a tap is only a tap once the rope is nearly still). */
  isAtRest(epsX = EPS_X, epsV = EPS_V): boolean {
    return Math.abs(this.target - this.x) < epsX && Math.abs(this.v) < epsV;
  }

  /** Snap exactly onto the target once at rest, so nothing drifts forever. */
  settle(): void {
    this.x = this.target;
    this.v = 0;
  }
}
