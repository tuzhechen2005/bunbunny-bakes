import { describe, expect, it } from "vitest";
import {
  AXIS_LOCK_PX,
  FLING_PAUSE_MS,
  GestureTracker,
  RUBBER_BAND_LIMIT,
  VELOCITY_WINDOW_MS,
  rubberBand,
  snapTarget,
} from "@/lib/motion/gesture";

describe("FRONTEND.md section 5 gesture constants are pinned", () => {
  it("values", () => {
    expect(AXIS_LOCK_PX).toBe(8);
    expect(RUBBER_BAND_LIMIT).toBe(0.45);
    expect(VELOCITY_WINDOW_MS).toBe(100);
    expect(FLING_PAUSE_MS).toBe(80);
  });

  it("axis lock happens at exactly 8 px, not 7.9", () => {
    const under = new GestureTracker();
    under.start(0, 0, 0);
    expect(under.move(7.9, 0, 10)).toBeNull();
    expect(under.axis).toBeNull();
    const at = new GestureTracker();
    at.start(0, 0, 0);
    expect(at.move(8, 0, 10)).toBe(8);
    expect(at.axis).toBe("x");
  });

  it("rubber band approaches 0.45 for a huge overshoot and is 0.225 at an overshoot of 0.45", () => {
    expect(rubberBand(3 + 1e6, 0, 3) - 3).toBeCloseTo(0.45, 3);
    expect(rubberBand(3.45, 0, 3) - 3).toBeCloseTo(0.225, 6);
    expect(rubberBand(-1e6, 0, 3)).toBeCloseTo(-0.45, 3);
  });

  it("velocity uses a 100 ms window: older samples are ignored", () => {
    const g = new GestureTracker();
    g.start(0, 0, 0);
    g.move(100, 0, 10);
    g.move(101, 0, 120);
    g.move(111, 0, 220); // inside the last 100 ms: 10 px over 100 ms
    expect(g.end(225).velocity).toBeCloseTo(0.1, 6);
  });
});

describe("GestureTracker axis lock", () => {
  it("stays undecided under 8 px, then locks horizontal", () => {
    const g = new GestureTracker();
    g.start(0, 0, 0);
    expect(g.move(5, 2, 10)).toBeNull();
    expect(g.axis).toBeNull();
    expect(g.move(12, 3, 20)).toBe(12);
    expect(g.axis).toBe("x");
    // Once locked it stays locked even if the finger drifts vertically.
    expect(g.move(14, 60, 30)).toBe(14);
    expect(g.axis).toBe("x");
  });

  it("locks vertical and never reports x movement (page scrolls)", () => {
    const g = new GestureTracker();
    g.start(0, 0, 0);
    expect(g.move(2, 10, 10)).toBeNull();
    expect(g.axis).toBe("y");
    expect(g.move(30, 40, 20)).toBeNull();
    expect(g.end(25)).toEqual({ velocity: 0, fling: 0 });
  });
});

describe("GestureTracker release", () => {
  function drag(points: [number, number][], releaseAt: number) {
    const g = new GestureTracker();
    g.start(0, 0, 0);
    for (const [x, t] of points) g.move(x, 0, t);
    return g.end(releaseAt);
  }

  it("measures velocity over the last 100 ms only", () => {
    // Slow for 300 ms (0.1 px/ms), then fast for the last 100 ms (1 px/ms).
    const slow: [number, number][] = [];
    for (let t = 20; t <= 300; t += 20) slow.push([t * 0.1, t]);
    const fast: [number, number][] = [];
    for (let t = 320; t <= 400; t += 20) fast.push([30 + (t - 300), t]);
    const end = drag([...slow, ...fast], 405);
    expect(end.velocity).toBeCloseTo(1, 1);
    expect(end.fling).toBe(1);
  });

  it("flings in the drag direction (negative = left)", () => {
    expect(drag([[-20, 20], [-50, 40], [-90, 60]], 65).fling).toBe(-1);
  });

  it("no fling when the finger paused more than 80 ms before release", () => {
    const end = drag([[20, 20], [60, 40], [100, 60]], 60 + 81);
    expect(end).toEqual({ velocity: 0, fling: 0 });
  });

  it("a fling just inside the pause window still counts", () => {
    expect(drag([[20, 20], [60, 40], [100, 60]], 60 + 79).fling).toBe(1);
  });

  it("slow drags are not flings", () => {
    const end = drag([[10, 100], [20, 200], [30, 300]], 305);
    expect(end.fling).toBe(0);
  });

  it("a tap with no movement has no velocity", () => {
    const g = new GestureTracker();
    g.start(5, 5, 0);
    expect(g.end(50)).toEqual({ velocity: 0, fling: 0 });
  });
});

describe("rubberBand", () => {
  it("is the identity inside the range", () => {
    expect(rubberBand(2, 0, 3)).toBe(2);
    expect(rubberBand(0, 0, 3)).toBe(0);
  });

  it("compresses overshoot and never exceeds 0.45 items", () => {
    for (const over of [0.1, 0.5, 1, 5, 100]) {
      expect(rubberBand(3 + over, 0, 3) - 3).toBeLessThan(0.45);
      expect(-(rubberBand(-over, 0, 3))).toBeLessThan(0.45);
    }
    expect(rubberBand(3.1, 0, 3) - 3).toBeGreaterThan(0.07);
    expect(rubberBand(3.1, 0, 3)).toBeLessThan(3.1);
  });

  it("is monotonic", () => {
    expect(rubberBand(3.6, 0, 3)).toBeGreaterThan(rubberBand(3.3, 0, 3));
  });
});

describe("snapTarget", () => {
  it("snaps to the nearest item without a fling", () => {
    expect(snapTarget(2.4, 0, 0, 5)).toBe(2);
    expect(snapTarget(2.6, 0, 0, 5)).toBe(3);
  });

  it("a fling moves at most one item from the start", () => {
    expect(snapTarget(3.4, 1, 1, 5)).toBe(2);
    expect(snapTarget(0.2, 1, -1, 5)).toBe(0);
  });

  it("clamps to the ends", () => {
    expect(snapTarget(4.4, 4, 1, 5)).toBe(4);
    expect(snapTarget(-0.4, 0, -1, 5)).toBe(0);
    expect(snapTarget(9, 0, 0, 5)).toBe(4);
  });
});
