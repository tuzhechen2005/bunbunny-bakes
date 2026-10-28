// Game feel is part of the contract (D128, numbers tuned with scripts/tu-tune.mts). With the
// owner's 8 tiers and information-limited bots (they only see visible tiles): a random tapper is
// out in batch 1; a simple greedy player almost always clears batches 1-2, hits the wall in
// batch 3 (median end batch 3) and rarely gets past batch 4. Changing BATCHES, BAG_SIZE or the
// generator moves these numbers.

import { describe, expect, it } from "vitest";
import { createTuGame, MAX_TAPS } from "@/lib/tu";
import { greedyTu, playerView, randomTu } from "../support/tuBot";

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const TIERS = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}` }));
const seeds = Array.from({ length: 200 }, (_, i) => `tune${i}`);

describe("game length with 8 tiers", () => {
  it("random play is over in batch 1", () => {
    const runs = seeds.map((s) => randomTu(s, TIERS));
    expect(runs.every((r) => r.over)).toBe(true);
    expect(runs.filter((r) => r.batch === 1).length).toBeGreaterThanOrEqual(0.88 * seeds.length);
    expect(runs.filter((r) => r.batch <= 2).length).toBeGreaterThanOrEqual(0.98 * seeds.length);
  });

  it("greedy play clears batches 1-2, stops in batch 3 (median), rarely passes batch 4, never hits the tap cap", () => {
    const runs = seeds.map((s) => greedyTu(s, TIERS));
    expect(median(runs.map((r) => r.batch))).toBe(3);
    expect(runs.filter((r) => r.batch <= 2).length).toBeLessThanOrEqual(0.1 * seeds.length);
    expect(runs.filter((r) => r.batch >= 5).length).toBeLessThanOrEqual(0.15 * seeds.length);
    expect(runs.filter((r) => r.taps.length >= MAX_TAPS)).toEqual([]);
  });
});

describe("bots are information-limited", () => {
  it("the bots choose from playerView, which drops every hidden tile", () => {
    const g = createTuGame({ seed: "view", tiers: TIERS });
    const s = g.state();
    const v = playerView(s);
    expect(s.tiles.some((t) => !t.visible)).toBe(true);
    expect(v.tiles).toEqual(s.tiles.filter((t) => t.visible));
  });
});
