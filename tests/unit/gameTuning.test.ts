// Game feel is part of the contract: changing radii, gravity, danger line or points changes how long a
// game lasts. These fixed seeds pin it: a casual (random) player's game piles up after about a minute
// of drops, a careful (greedy) player rarely reaches the 600-drop cap, and scores spread widely.

import { describe, expect, it } from "vitest";
import { defaultTierDefs, MAX_DROPS } from "@/lib/game";
import { botRun, greedyRun } from "../support/gameBot";

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

describe.each([
  ["5 products", ["a", "b", "c", "d", "e"]],
  ["4 products", ["a", "b", "c", "d"]],
])("game length with %s", (_name, ids) => {
  const tiers = defaultTierDefs(ids);
  const seeds = Array.from({ length: 20 }, (_, i) => i);

  it("random play ends by piling up: median 60-150 drops, never above 300", () => {
    const drops = seeds.map((s) => botRun(`r${s}`, tiers, MAX_DROPS).log.length);
    expect(median(drops)).toBeGreaterThanOrEqual(60);
    expect(median(drops)).toBeLessThanOrEqual(150);
    expect(Math.max(...drops)).toBeLessThan(300);
  });

  it("careful play reaches the drop cap in at most 1 of 20 games and scores spread widely", () => {
    const runs = seeds.map((s) => greedyRun(`g${s}`, tiers, MAX_DROPS));
    expect(runs.filter((r) => r.drops >= MAX_DROPS).length).toBeLessThanOrEqual(1);
    const scores = runs.map((r) => r.score);
    expect(Math.max(...scores)).toBeGreaterThanOrEqual(3 * Math.min(...scores));
  });
});
