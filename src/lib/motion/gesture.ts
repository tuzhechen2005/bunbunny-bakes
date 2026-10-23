/**
 * Drag bookkeeping for the rope carousel: axis lock, rubber band, release velocity, fling rule.
 * Pure TS. The tracker works in px/ms; rubberBand and snapTarget work in item units.
 */

export const AXIS_LOCK_PX = 8;
export const RUBBER_BAND_LIMIT = 0.45;
export const VELOCITY_WINDOW_MS = 100;
export const FLING_PAUSE_MS = 80;
/** Minimum release speed (px/ms) that counts as a fling. */
export const FLING_MIN_SPEED = 0.3;

export type Axis = "x" | "y";

interface Sample {
  x: number;
  t: number;
}

/**
 * iOS-style rubber band. Inside [min, max] the position is unchanged; beyond it the overshoot
 * is compressed so it never exceeds `limit` (slope 1 at the edge, asymptote at limit).
 */
export function rubberBand(pos: number, min: number, max: number, limit = RUBBER_BAND_LIMIT): number {
  if (pos < min) return min - squash(min - pos, limit);
  if (pos > max) return max + squash(pos - max, limit);
  return pos;
}

function squash(over: number, limit: number): number {
  return (limit * over) / (over + limit);
}

/**
 * Which item to settle on after release. A fling (direction -1 | 0 | 1 in item units) moves at
 * most one item from where the drag started; otherwise snap to the nearest item.
 */
export function snapTarget(position: number, startIndex: number, flingDir: -1 | 0 | 1, count: number): number {
  const raw = flingDir === 0 ? Math.round(position) : startIndex + flingDir;
  return Math.max(0, Math.min(count - 1, raw));
}

export interface GestureEnd {
  /** Release velocity in px/ms along x (0 when the finger paused or there was no drag). */
  velocity: number;
  /** Sign of a fling in px direction (0 = no fling). */
  fling: -1 | 0 | 1;
}

export class GestureTracker {
  /** null until the finger has moved AXIS_LOCK_PX; then fixed for the rest of the gesture. */
  axis: Axis | null = null;
  private startX = 0;
  private startY = 0;
  private samples: Sample[] = [];
  private active = false;

  start(x: number, y: number, t: number): void {
    this.active = true;
    this.axis = null;
    this.startX = x;
    this.startY = y;
    this.samples = [{ x, t }];
  }

  /**
   * Feed a pointer move. Returns the x displacement from the start while the gesture belongs
   * to the horizontal axis, otherwise null (undecided or vertical: let the page scroll).
   */
  move(x: number, y: number, t: number): number | null {
    if (!this.active) return null;
    const dx = x - this.startX;
    const dy = y - this.startY;
    if (this.axis === null && Math.hypot(dx, dy) >= AXIS_LOCK_PX) {
      this.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
    }
    if (this.axis !== "x") return null;
    this.samples.push({ x, t });
    return dx;
  }

  /** Release at time `t`. Velocity uses the last 100 ms; a pause over 80 ms cancels a fling. */
  end(t: number): GestureEnd {
    const none: GestureEnd = { velocity: 0, fling: 0 };
    if (!this.active) return none;
    this.active = false;
    const last = this.samples[this.samples.length - 1];
    if (this.axis !== "x" || !last || this.samples.length < 2) return none;
    if (t - last.t > FLING_PAUSE_MS) return none;
    const from = this.samples.find((s) => s.t >= last.t - VELOCITY_WINDOW_MS) ?? last;
    const dt = last.t - from.t;
    if (dt <= 0) return none;
    const velocity = (last.x - from.x) / dt;
    const fling = Math.abs(velocity) >= FLING_MIN_SPEED ? (Math.sign(velocity) as 1 | -1) : 0;
    return { velocity, fling };
  }

  cancel(): void {
    this.active = false;
    this.axis = null;
    this.samples = [];
  }
}
