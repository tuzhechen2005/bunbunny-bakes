import { describe, expect, it } from "vitest";
import {
  CARD_MAX_PX,
  ROPE_SAG,
  ROPE_Y0,
  STRAND_STEP,
  cardPose,
  dropDelayMs,
  dropStartPx,
  nearestIndex,
  rackMetrics,
  restAngle,
  ropePath,
  ropeStrands,
  ropeY,
} from "@/components/customer/rack/geometry";
import { AXIS_LOCK_PX, GestureTracker, decideAxis } from "@/lib/motion/gesture";
import { Spring } from "@/lib/motion/spring";

describe("rack metrics (prototype layout)", () => {
  it("card is 54% of the rack, at most 232 px, spacing = card + 24", () => {
    expect(rackMetrics(375)).toMatchObject({ cardW: 203, spacing: 227, y0: ROPE_Y0, sag: ROPE_SAG });
    expect(rackMetrics(320).cardW).toBe(173);
    expect(rackMetrics(430).cardW).toBe(CARD_MAX_PX);
    expect(rackMetrics(1200).cardW).toBe(CARD_MAX_PX);
  });

  it("rack height holds rope, sag, photo and the shadow room", () => {
    expect(rackMetrics(375).height).toBe(20 + 12 + 203 + 38);
  });

  it("falls back to 375 px when the rack has no width yet", () => {
    expect(rackMetrics(0).width).toBe(375);
  });
});

describe("rope curve", () => {
  const m = rackMetrics(375);

  it("sags exactly `sag` in the middle and is level at the ends of the screen", () => {
    expect(ropeY(0, m, 12)).toBeCloseTo(32, 6);
    expect(ropeY(-m.width / 2 - 30, m, 12)).toBeCloseTo(20, 6);
    expect(ropeY(m.width / 2 + 30, m, 12)).toBeCloseTo(20, 6);
  });

  it("the quadratic path runs 30 px past both edges with control point 2*sag down", () => {
    expect(ropePath(m, 12)).toBe("M -30 20 Q 187.5 44.00 405 20");
  });

  it("strands follow the rope: one dash per step, all finite", () => {
    const s = ropeStrands(m, 12);
    const dashes = s.dark.split("M").length - 1;
    expect(dashes).toBe(Math.floor((m.width + 60) / STRAND_STEP) + 1);
    expect(s.light.split("M").length - 1).toBe(dashes);
    expect(s.dark).not.toMatch(/NaN|Infinity/);
  });
});

describe("card poses", () => {
  const m = rackMetrics(375);

  it("the centred card is full size on top of the stack", () => {
    const p = cardPose(2, 2, m, 12);
    expect(p).toMatchObject({ cx: 187.5, scale: 1, opacity: 1, zIndex: 10 });
    expect(p.top).toBeCloseTo(ROPE_Y0 + ROPE_SAG - 2, 6);
  });

  it("neighbours sit one spacing away and shrink by 14%", () => {
    const left = cardPose(1, 2, m, 12);
    const right = cardPose(3, 2, m, 12);
    expect(left.cx).toBeCloseTo(187.5 - 227, 6);
    expect(right.cx).toBeCloseTo(187.5 + 227, 6);
    expect(left.scale).toBeCloseTo(0.86, 6);
    expect(left.zIndex).toBe(9);
  });

  it("shrinks smoothly while the rope moves and hides cards beyond 2.4 slots", () => {
    expect(cardPose(1, 0.5, m, 12).scale).toBeCloseTo(1 - 0.14 * 0.5, 6);
    expect(cardPose(3, 0, m, 12).opacity).toBe(0);
    expect(cardPose(2, 0, m, 12).opacity).toBe(1);
  });

  it("nearestIndex clamps to the menu", () => {
    expect(nearestIndex(-0.4, 4)).toBe(0);
    expect(nearestIndex(1.6, 4)).toBe(2);
    expect(nearestIndex(9, 4)).toBe(3);
  });

  it("entrance drop: later cards start higher and later; pegs rest at slightly different angles", () => {
    expect(dropDelayMs(0)).toBe(120);
    expect(dropDelayMs(3)).toBe(450);
    expect(dropStartPx(0)).toBe(-420);
    expect(dropStartPx(2)).toBe(-500);
    expect(restAngle(0)).toBeCloseTo((0.7 * Math.PI) / 180, 9);
    expect(restAngle(4)).toBe(restAngle(0));
  });
});

describe("axis decision for touch drags (D77)", () => {
  it("plain bias 1 is 'more horizontal than vertical'", () => {
    expect(decideAxis(10, 10)).toBe("x");
    expect(decideAxis(9, 10)).toBe("y");
    expect(decideAxis(-12, 3)).toBe("x");
  });

  it("the rope's 0.75 bias keeps diagonal flicks (up to about 53 degrees) for the rope", () => {
    expect(decideAxis(8, 10, 0.75)).toBe("x"); // 8 >= 7.5
    expect(decideAxis(7, 10, 0.75)).toBe("y");
    expect(decideAxis(5, 40, 0.75)).toBe("y"); // a scroll stays a scroll
  });

  it("GestureTracker keeps its pinned defaults (8 px lock, bias 1)", () => {
    const g = new GestureTracker();
    g.start(0, 0, 0);
    expect(g.move(7, 7.5, 5)).toBeNull(); // hypot 10.3 >= 8: locked, 7 < 7.5 so vertical
    expect(g.axis).toBe("y");
    expect(AXIS_LOCK_PX).toBe(8);
  });

  it("options: lock at 4 px with the 0.75 bias", () => {
    const g = new GestureTracker({ lockPx: 4, horizontalBias: 0.75 });
    g.start(100, 100, 0);
    expect(g.move(102, 101, 4)).toBeNull(); // 2.2 px: still a possible tap
    expect(g.axis).toBeNull();
    expect(g.move(106, 107, 8)).toBe(6); // 6 >= 0.75 * 7: horizontal
    expect(g.axis).toBe("x");
    expect(g.isActive).toBe(true);
  });

  it("options: a mostly vertical start stays vertical and never reports x", () => {
    const g = new GestureTracker({ lockPx: 4, horizontalBias: 0.75 });
    g.start(0, 0, 0);
    expect(g.move(1, 6, 5)).toBeNull();
    expect(g.axis).toBe("y");
    expect(g.move(60, 10, 12)).toBeNull();
    expect(g.end(14)).toEqual({ velocity: 0, fling: 0 });
  });
});

describe("Spring.isAtRest accepts looser thresholds (tap-while-moving test)", () => {
  it("default thresholds are unchanged; custom ones loosen the test", () => {
    const s = new Spring(0);
    s.x = 0.05;
    expect(s.isAtRest()).toBe(false);
    expect(s.isAtRest(0.06, 0.6)).toBe(true);
  });
});
