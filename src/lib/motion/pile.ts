/**
 * The pile inside the paper bag window (FRONTEND.md 4.3, D78): round bread thumbnails that fall,
 * collide, roll and come to rest. Pure TS, no DOM, no React. Positions are in "world units":
 * the box is `PILE_WIDTH` wide, its height follows the window aspect, y grows downward.
 *
 * Verlet integration at a fixed 1/120 s step (the remainder of a frame is carried over, so 60 and
 * 120 Hz agree), gravity 1500 units/s^2, 4 constraint iterations per step, wall and floor
 * friction. Bodies shrink as `20 * sqrt(5 / n)` (min 9.5) once there are more than 5, and at most
 * `PILE_CAP` are simulated. The world falls asleep after 40 quiet steps and `advance` then costs
 * nothing until `wake()` (spawn, remove, shaking and `jolt` all wake it).
 */

export const PILE_WIDTH = 116;
/** Height of the box for the real bag window: 116 * (57% * 1.497) / 73% (see PaperBag). */
export const PILE_HEIGHT = 135.6;
export const PILE_GRAVITY = 1500;
export const PILE_CAP = 24;
/** Fixed physics step in seconds. */
export const PILE_STEP = 1 / 120;
const BASE_RADIUS = 20;
const MIN_RADIUS = 9.5;
const ITERATIONS = 4;
/** Steps with (almost) no movement before the world sleeps. */
const SLEEP_STEPS = 40;
/** Per-step displacement (world units) below which a step counts as quiet. */
const QUIET = 0.015;
const SETTLE_STEPS = 900;

/** Body radius for `n` bodies in the bag. */
export function radiusFor(n: number): number {
  return n <= 5 ? BASE_RADIUS : Math.max(MIN_RADIUS, BASE_RADIUS * Math.sqrt(5 / n));
}

export interface PileBody {
  /** Unique, stable for the life of the body (use it as a DOM key). */
  id: number;
  /** What the body stands for (a product id). */
  tag: string;
  x: number;
  y: number;
  /** Previous position (Verlet). */
  px: number;
  py: number;
  /** Current and target radius (the radius eases toward the target). */
  r: number;
  tr: number;
  /** Rotation in radians (rolls with horizontal movement). */
  a: number;
}

export interface PileOptions {
  width?: number;
  height?: number;
  /** Source of randomness in [0, 1); pass a seeded one for deterministic tests. */
  random?: () => number;
  gravity?: number;
  cap?: number;
}

export class PileWorld {
  readonly width: number;
  height: number;
  readonly cap: number;
  gravity: number;
  /** External acceleration in world units/s^2 (shaking the bag). Non-zero keeps the world awake. */
  ax = 0;
  ay = 0;
  bodies: PileBody[] = [];
  private asleep = true;
  private quiet = 0;
  private acc = 0;
  private uid = 0;
  private readonly random: () => number;

  constructor(opts: PileOptions = {}) {
    this.width = opts.width ?? PILE_WIDTH;
    this.height = opts.height ?? PILE_HEIGHT;
    this.cap = opts.cap ?? PILE_CAP;
    this.gravity = opts.gravity ?? PILE_GRAVITY;
    this.random = opts.random ?? Math.random;
  }

  get size(): number {
    return this.bodies.length;
  }

  get awake(): boolean {
    return !this.asleep;
  }

  count(tag: string): number {
    let n = 0;
    for (const b of this.bodies) if (b.tag === tag) n++;
    return n;
  }

  /**
   * Drop a body in from above the box. `x` is a world x position (default: near the middle),
   * `y` the start height (default: just above the box; the initial pile from the cart staggers it).
   * Returns null when the cap is reached.
   */
  spawn(tag: string, x?: number, y?: number): PileBody | null {
    if (this.bodies.length >= this.cap) return null;
    const r = radiusFor(this.bodies.length + 1);
    for (const b of this.bodies) b.tr = r;
    const rawX = x ?? this.width / 2 + (this.random() - 0.5) * 30;
    const bx = Math.min(Math.max(rawX, r), this.width - r);
    // A little height jitter: bodies dropped together must not land on the floor in one exact
    // row (equal y means no vertical push, so a row wider than the box would never resolve).
    const by = (y ?? -r * 1.1) - this.random() * r * 0.5;
    const body: PileBody = {
      id: ++this.uid,
      tag,
      x: bx,
      y: by,
      px: bx - (this.random() - 0.5) * 1.2,
      py: by - 2.6,
      r,
      tr: r,
      a: this.random() * 6.28,
    };
    this.bodies.push(body);
    this.wake();
    return body;
  }

  /** Remove up to `count` bodies with this tag, topmost first. Returns the removed bodies. */
  remove(tag: string, count: number): PileBody[] {
    const hit = this.bodies
      .filter((b) => b.tag === tag)
      .sort((p, q) => p.y - q.y)
      .slice(0, Math.max(0, count));
    if (hit.length === 0) return hit;
    const gone = new Set(hit);
    this.bodies = this.bodies.filter((b) => !gone.has(b));
    const r = radiusFor(this.bodies.length);
    for (const b of this.bodies) b.tr = r;
    this.wake();
    return hit;
  }

  wake(): void {
    this.asleep = false;
    this.quiet = 0;
  }

  /** One fixed step of `h` seconds. Returns the largest displacement of any body this step. */
  step(h: number = PILE_STEP): number {
    const bs = this.bodies;
    const n = bs.length;
    const W = this.width;
    const H = this.height;
    for (let i = 0; i < n; i++) {
      const b = bs[i];
      const vx = (b.x - b.px) * 0.994;
      const vy = (b.y - b.py) * 0.994;
      b.px = b.x;
      b.py = b.y;
      b.r += (b.tr - b.r) * 0.08;
      b.x += vx + this.ax * h * h;
      b.y += vy + (this.gravity + this.ay) * h * h;
    }
    for (let it = 0; it < ITERATIONS; it++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const A = bs[i];
          const B = bs[j];
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const d = Math.hypot(dx, dy);
          const m = A.r + B.r;
          if (d < m) {
            if (d > 1e-4) {
              const o = ((m - d) / d) * 0.5;
              A.x -= dx * o;
              A.y -= dy * o;
              B.x += dx * o;
              B.y += dy * o;
            } else {
              // Exactly on top of each other: any direction will do, but it must be deterministic.
              A.x -= 0.05;
              B.x += 0.05;
            }
          }
        }
      }
      for (let i = 0; i < n; i++) {
        const c = bs[i];
        if (c.x < c.r) c.x = c.r;
        if (c.x > W - c.r) c.x = W - c.r;
        if (c.y > H - c.r) {
          c.y = H - c.r;
          c.px = c.x - (c.x - c.px) * 0.82; // floor friction
        }
        if (c.y < -H) c.y = -H;
      }
    }
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const e = bs[i];
      e.a += (e.x - e.px) / e.r;
      moved = Math.max(moved, Math.abs(e.x - e.px), Math.abs(e.y - e.py));
    }
    return moved;
  }

  /**
   * Advance by `dt` seconds of real time (any size). Returns true while the world is awake and
   * the caller should keep its animation loop running; false once everything rests.
   */
  advance(dt: number): boolean {
    if (this.asleep) return false;
    this.acc += Math.max(0, dt);
    while (this.acc >= PILE_STEP - 1e-9) {
      this.acc -= PILE_STEP;
      const moved = this.step(PILE_STEP);
      if (moved < QUIET && !this.ax && !this.ay) {
        if (++this.quiet > SLEEP_STEPS) {
          this.asleep = true;
          this.acc = 0;
          break;
        }
      } else {
        this.quiet = 0;
      }
    }
    if (this.acc < 0) this.acc = 0;
    return !this.asleep;
  }

  /** Run the simulation to rest at once (reduced motion, and the initial state from the cart). */
  settle(maxSteps: number = SETTLE_STEPS): void {
    this.acc = 0;
    this.quiet = 0;
    for (let k = 0; k < maxSteps; k++) {
      const moved = this.step(PILE_STEP);
      if (moved < QUIET && !this.ax && !this.ay) {
        if (++this.quiet > SLEEP_STEPS) break;
      } else {
        this.quiet = 0;
      }
    }
    // A settled body has finished easing its radius, too.
    for (const b of this.bodies) b.r = b.tr;
    this.asleep = true;
  }
}
