import { describe, expect, it } from "vitest";
import {
  PILE_CAP,
  PILE_HEIGHT,
  PILE_STEP,
  PILE_WIDTH,
  PileWorld,
  radiusFor,
  type PileBody,
} from "@/lib/motion/pile";

/** Small deterministic PRNG (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function world(seed = 1): PileWorld {
  return new PileWorld({ random: seeded(seed) });
}

function fill(w: PileWorld, n: number, tag = "a") {
  for (let i = 0; i < n; i++) w.spawn(tag);
}

function maxOverlap(bodies: readonly PileBody[]): number {
  let worst = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const d = Math.hypot(bodies[j].x - bodies[i].x, bodies[j].y - bodies[i].y);
      worst = Math.max(worst, bodies[i].r + bodies[j].r - d);
    }
  }
  return worst;
}

describe("radiusFor", () => {
  it("is 20 up to five bodies, then shrinks as 20*sqrt(5/n) down to 9.5", () => {
    expect(radiusFor(1)).toBe(20);
    expect(radiusFor(5)).toBe(20);
    expect(radiusFor(10)).toBeCloseTo(20 * Math.sqrt(0.5), 6);
    expect(radiusFor(24)).toBe(9.5);
    expect(radiusFor(100)).toBe(9.5);
  });
});

describe("PileWorld", () => {
  it("uses the documented box", () => {
    const w = world();
    expect(w.width).toBe(116);
    expect(PILE_WIDTH).toBe(116);
    expect(w.height).toBe(PILE_HEIGHT);
    expect(w.gravity).toBe(1500);
  });

  it("settles every body inside the box without overlap", () => {
    for (const n of [1, 3, 5, 9, 16, 24]) {
      const w = world(n);
      fill(w, n);
      w.settle();
      expect(w.awake).toBe(false);
      for (const b of w.bodies) {
        expect(b.x).toBeGreaterThanOrEqual(b.r - 1e-6);
        expect(b.x).toBeLessThanOrEqual(w.width - b.r + 1e-6);
        expect(b.y).toBeLessThanOrEqual(w.height - b.r + 1e-6);
        expect(b.y).toBeGreaterThanOrEqual(b.r - 1); // fell into the box
      }
      // Verlet with 4 iterations leaves a little penetration under a stack: allow 20% of a radius.
      expect(maxOverlap(w.bodies)).toBeLessThan(0.2 * w.bodies[0].r);
    }
  });

  it("a single body lies on the floor", () => {
    const w = world();
    w.spawn("a", 58);
    w.settle();
    const b = w.bodies[0];
    expect(b.y).toBeCloseTo(w.height - b.r, 3);
  });

  it("respects the cap of 24 bodies", () => {
    const w = world();
    for (let i = 0; i < 40; i++) w.spawn("a");
    expect(w.size).toBe(PILE_CAP);
    expect(w.spawn("a")).toBeNull();
    w.settle();
    expect(w.size).toBe(24);
    expect(w.bodies[0].r).toBeCloseTo(radiusFor(24), 3);
  });

  it("shrinks existing bodies toward the new radius when more arrive", () => {
    const w = world();
    fill(w, 5);
    w.settle();
    expect(w.bodies[0].r).toBe(20);
    w.spawn("a");
    expect(w.bodies[0].tr).toBeCloseTo(radiusFor(6), 6);
  });

  it("falls asleep after settling and wakes on spawn, remove and external acceleration", () => {
    const w = world();
    fill(w, 4);
    let guard = 0;
    while (w.advance(1 / 60) && guard++ < 2000);
    expect(guard).toBeLessThan(2000);
    expect(w.awake).toBe(false);
    const snapshot = w.bodies.map((b) => [b.x, b.y]);
    expect(w.advance(1)).toBe(false); // asleep: nothing moves
    expect(w.bodies.map((b) => [b.x, b.y])).toEqual(snapshot);

    w.spawn("b");
    expect(w.awake).toBe(true);
    w.settle();
    expect(w.awake).toBe(false);
    w.remove("b", 1);
    expect(w.awake).toBe(true);
    w.settle();

    w.ay = -30000; // a slam from below
    w.wake();
    const y0 = w.bodies.map((b) => b.y);
    for (let i = 0; i < 6; i++) w.advance(PILE_STEP);
    w.ay = 0;
    expect(w.bodies.some((b, i) => b.y < y0[i] - 1)).toBe(true);
  });

  it("does not sleep while an external acceleration is applied", () => {
    const w = world();
    fill(w, 3);
    w.settle();
    w.wake();
    w.ax = 5000;
    for (let i = 0; i < 300; i++) w.advance(PILE_STEP);
    expect(w.awake).toBe(true);
  });

  it("shaking sideways pushes the pile toward the wall", () => {
    const w = world();
    fill(w, 5);
    w.settle();
    const meanX = () => w.bodies.reduce((s, b) => s + b.x, 0) / w.size;
    const before = meanX();
    w.ax = 60000;
    w.wake();
    for (let i = 0; i < 30; i++) w.advance(PILE_STEP);
    w.ax = 0;
    expect(meanX()).toBeGreaterThan(before + 5);
  });

  it("is deterministic with a seeded random source", () => {
    const run = (seed: number) => {
      const w = world(seed);
      fill(w, 12);
      w.settle();
      return w.bodies.map((b) => [b.x, b.y, b.a].map((v) => Math.round(v * 1e6)));
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it("gives the same result at 60 and 120 Hz frame rates", () => {
    const at = (hz: number) => {
      const w = world(3);
      fill(w, 6);
      for (let i = 0; i < hz; i++) w.advance(1 / hz); // one second
      return w.bodies.map((b) => b.y);
    };
    const a = at(60);
    const b = at(120);
    a.forEach((y, i) => expect(y).toBeCloseTo(b[i], 3));
  });

  it("remove() takes the topmost bodies of that tag", () => {
    const w = world();
    fill(w, 3, "a");
    fill(w, 3, "b");
    w.settle();
    const topA = [...w.bodies.filter((b) => b.tag === "a")].sort((p, q) => p.y - q.y)[0];
    const removed = w.remove("a", 1);
    expect(removed).toEqual([topA]);
    expect(w.count("a")).toBe(2);
    expect(w.count("b")).toBe(3);
    expect(w.remove("nope", 3)).toEqual([]);
    expect(w.remove("a", 0)).toEqual([]);
    expect(w.remove("a", 9)).toHaveLength(2);
  });

  it("separates bodies spawned exactly on top of each other", () => {
    const w = world();
    w.spawn("a", 58, -20);
    w.spawn("a", 58, -20);
    for (const b of w.bodies) {
      b.px = b.x;
      b.py = b.y;
    }
    w.settle();
    expect(maxOverlap(w.bodies)).toBeLessThan(0.2 * w.bodies[0].r);
    const [a, b] = w.bodies;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1.6 * a.r);
  });

  it("spawns inside the walls even when asked for an x outside", () => {
    const w = world();
    const b = w.spawn("a", -50)!;
    expect(b.x).toBe(b.r);
    const c = w.spawn("a", 999)!;
    expect(c.x).toBe(w.width - c.r);
  });
});
