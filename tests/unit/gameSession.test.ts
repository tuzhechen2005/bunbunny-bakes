import { describe, expect, it } from "vitest";
import { Session } from "@/components/game/engine";
import type { TierView } from "@/components/game/types";

const TIERS: TierView[] = [0.08, 0.11, 0.15, 0.2, 0.3].map((radius, i) => ({
  id: i === 4 ? "big" : `t${i}`,
  radius,
  points: i * 10,
  imageUrl: null,
  color: { bg: "#ffffff", ink: "#000000" },
}));

describe("game Session (UI-side wrapper of the engine)", () => {
  it("enforces the cool-down and logs monotonic drops", () => {
    const s = new Session(TIERS, "seed-a");
    expect(s.canDrop()).toBe(true);
    expect(s.drop(0.5)).not.toBeNull();
    expect(s.drop(0.4)).toBeNull();
    s.advance(29);
    expect(s.canDrop()).toBe(false);
    s.advance(1);
    expect(s.drop(2)).not.toBeNull();
    expect(s.drops.map((d) => d.at)).toEqual([0, 30]);
    // x is clamped into the board before it is logged
    expect(s.drops[1].x).toBeLessThanOrEqual(1);
  });

  it("is deterministic for a seed and only hands out the 3 smallest tiers", () => {
    const run = () => {
      const s = new Session(TIERS, "seed-b");
      const seq: number[] = [];
      for (let i = 0; i < 20; i++) {
        s.advance(30);
        seq.push(s.current());
        s.drop(0.1 + (i % 7) * 0.13);
      }
      return { seq, score: s.score, over: s.over };
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(a.seq.every((t) => t >= 0 && t <= 2)).toBe(true);
  });
});
