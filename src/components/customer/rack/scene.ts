/**
 * Drives the rope rack's DOM from the motion primitives. One RopeScene per Rack: a position
 * spring for the rope, one pendulum per peg, and a rAF loop that sleeps once everything rests.
 * Transforms are written straight to the elements (never React state per frame).
 */
import {
  Pendulum,
  Spring,
  createLoop,
  pivotAccel,
  type Loop,
} from "@/lib/motion";
import { cardSize, pitch, ropeSag, slot } from "./layout";

/** Rope sag at the middle of the stage, px. */
export const SAG = 10;
/** Pixels per metre of pendulum world; tuned so a hard fling tilts the photo ~10-15 degrees. */
export const PX_PER_METRE = 600;

const DEG = 180 / Math.PI;

export class RopeScene {
  readonly spring = new Spring(0);
  pendulums: Pendulum[] = [];
  outer: (HTMLElement | null)[] = [];
  inner: (HTMLElement | null)[] = [];
  width = 0;
  count = 0;
  reduced = false;
  degraded = false;
  dragging = false;
  readonly loop: Loop;

  private lastX = 0;
  private v = 0;
  private prevPivotV = 0;

  constructor() {
    this.loop = createLoop((dt) => this.step(dt));
  }

  get size(): number {
    return cardSize(this.width);
  }

  private get swinging(): boolean {
    return !this.reduced && !this.degraded;
  }

  configure(count: number, width: number, reduced: boolean, degraded: boolean): void {
    this.count = count;
    this.width = width;
    this.reduced = reduced;
    this.degraded = degraded;
    while (this.pendulums.length < count) this.pendulums.push(new Pendulum());
    this.pendulums.length = count;
    const max = Math.max(0, count - 1);
    this.spring.target = Math.min(max, Math.max(0, this.spring.target));
    if (this.spring.x > max) {
      this.spring.set(max, 0);
      this.lastX = max;
    }
    if (!this.swinging) this.pendulums.forEach((p) => p.settle());
    this.apply();
  }

  /** Finger is down: the rope follows `pos` (item units) exactly. */
  dragTo(pos: number): void {
    this.dragging = true;
    this.spring.set(pos, 0);
    this.loop.start();
  }

  /** Finger lifted: spring toward `target` carrying the release velocity (items/s). */
  release(target: number, velocity: number): void {
    this.dragging = false;
    this.spring.target = target;
    if (this.reduced) {
      this.spring.set(target, 0);
      this.apply();
      return;
    }
    this.spring.set(this.spring.x, velocity);
    this.loop.start();
  }

  goTo(target: number, instant = false): void {
    this.spring.target = target;
    if (instant || this.reduced) {
      this.spring.set(target, 0);
      this.v = 0;
      this.lastX = target;
      this.apply();
      return;
    }
    this.loop.start();
  }

  /** Make the pegs sway (the photo was hung back on the rope). */
  kick(index: number): void {
    if (!this.swinging) return;
    this.pendulums.forEach((p, i) => {
      const dist = Math.abs(i - index);
      if (dist > 3) return;
      p.omega += (i === index ? 2.4 : -1.5 / dist) * (dist === 0 ? 1 : 0.8);
    });
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
  }

  private step(dt: number): boolean {
    let moving = false;
    let v: number;
    if (this.dragging) {
      const raw = dt > 0 ? (this.spring.x - this.lastX) / dt : 0;
      this.v += (raw - this.v) * 0.4;
      v = this.v;
      moving = true;
    } else {
      this.spring.step(dt);
      if (this.spring.isAtRest()) {
        this.spring.settle();
        v = 0;
      } else {
        v = this.spring.v;
        moving = true;
      }
      this.v = v;
    }
    this.lastX = this.spring.x;

    if (this.swinging) {
      // Cards move left when the position grows, so the pivot velocity has the opposite sign.
      const pivotV = -v * pitch(this.size);
      const acc = pivotAccel(this.prevPivotV, pivotV, dt, PX_PER_METRE);
      this.prevPivotV = pivotV;
      this.pendulums.forEach((p, i) => {
        // A little per-peg variety so the row does not swing in lockstep.
        p.step(dt, acc * (0.9 + 0.1 * (i % 3)));
        if (p.isAtRest()) p.settle();
        else moving = true;
      });
    }
    this.apply();
    return moving;
  }

  apply(): void {
    const size = this.size;
    const flat = this.reduced || this.degraded;
    for (let i = 0; i < this.count; i++) {
      const outer = this.outer[i];
      if (!outer) continue;
      const s = slot(i - this.spring.x, size);
      outer.style.visibility = s.visible ? "visible" : "hidden";
      outer.style.opacity = String(s.opacity);
      outer.style.zIndex = String(s.z);
      outer.style.transition = this.reduced ? "opacity 0.25s" : "";
      const sag = ropeSag(s.x, this.width, SAG);
      const rot = flat ? 0 : s.rotateY;
      outer.style.transform = `translate3d(${s.x.toFixed(2)}px, ${sag.toFixed(2)}px, 0) scale(${s.scale.toFixed(4)}) rotateY(${rot.toFixed(2)}deg)`;
      const inner = this.inner[i];
      if (inner) {
        const angle = this.swinging ? -this.pendulums[i].angle * DEG : 0;
        inner.style.transform = angle === 0 ? "" : `rotate(${angle.toFixed(2)}deg)`;
      }
    }
  }
}
