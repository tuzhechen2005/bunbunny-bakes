// Game feel is part of the contract (D122, numbers tuned with scripts/tu-tune.mts): with the
// owner's 8 tiers a random tapper is out in batch 1-2, a simple greedy player reaches batch 4-6
// (median), and almost nobody hits the tap cap. Changing BATCHES, BAG_SIZE or the generator moves
// these numbers.

import { describe, expect, it } from "vitest";
import { MAX_TAPS } from "@/lib/tu";
import { greedyTu, randomTu } from "../support/tuBot";

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const TIERS = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}` }));
const seeds = Array.from({ length: 200 }, (_, i) => `tune${i}`);

describe("game length with 8 tiers", () => {
  it("random play is over in batch 1-2", () => {
    const runs = seeds.map((s) => randomTu(s, TIERS));
    expect(runs.every((r) => r.over)).toBe(true);
    expect(runs.filter((r) => r.batch <= 2).length).toBeGreaterThanOrEqual(0.95 * seeds.length);
  });

  it("greedy play reaches batch 4-6 (median), rarely loses batch 1, never hits the tap cap", () => {
    const runs = seeds.map((s) => greedyTu(s, TIERS));
    const m = median(runs.map((r) => r.batch));
    expect(m).toBeGreaterThanOrEqual(4);
    expect(m).toBeLessThanOrEqual(6);
    expect(runs.filter((r) => r.batch === 1).length).toBeLessThanOrEqual(0.15 * seeds.length);
    expect(runs.filter((r) => r.taps.length >= MAX_TAPS)).toEqual([]);
  });
});
