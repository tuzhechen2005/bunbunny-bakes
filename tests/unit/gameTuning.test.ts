// Game feel is part of the contract: changing radii, gravity, danger line or points changes how long a
// game lasts. These fixed seeds pin it: a casual (random) player's game piles up after 25-60 drops
// (the radii were made 15% larger after owners found the first tuning, 60-150, too easy), a careful (greedy) player rarely reaches the 600-drop cap, and scores spread widely.
// With fewer products the chain of tiers is shorter, so the game is a little easier: 4 products get
// slightly wider bounds than the 5 products of a fully set up shop.

import { describe, expect, it } from "vitest";
import { defaultTierDefs, MAX_DROPS } from "@/lib/game";
import { botRun, greedyRun } from "../support/gameBot";

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

describe.each([
  { name: "5 products", ids: ["a", "b", "c", "d", "e"], randomMax: 300, caps: 1 },
  { name: "4 products", ids: ["a", "b", "c", "d"], randomMax: 450, caps: 4 },
])("game length with $name", ({ ids, randomMax, caps }) => {
  const tiers = defaultTierDefs(ids);
  const seeds = Array.from({ length: 20 }, (_, i) => i);

  it("random play ends by piling up: median 25-60 drops, max below the bound", () => {
    const drops = seeds.map((s) => botRun(`r${s}`, tiers, MAX_DROPS).log.length);
    expect(median(drops)).toBeGreaterThanOrEqual(25);
    expect(median(drops)).toBeLessThanOrEqual(60);
    expect(Math.max(...drops)).toBeLessThan(randomMax);
  });

  it("careful play rarely reaches the drop cap and scores spread widely", () => {
    const runs = seeds.map((s) => greedyRun(`g${s}`, tiers, MAX_DROPS));
    expect(runs.filter((r) => r.drops >= MAX_DROPS).length).toBeLessThanOrEqual(caps);
    const scores = runs.map((r) => r.score);
    expect(Math.max(...scores)).toBeGreaterThanOrEqual(3 * Math.min(...scores));
  });
});
