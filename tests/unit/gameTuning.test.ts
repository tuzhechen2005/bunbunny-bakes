// Game feel is part of the contract: changing radii, gravity, danger line or points changes how long a
// game lasts. These fixed seeds pin it: a casual (random) player's game piles up after 35-100 drops
// (pieces 8% larger, and 7+ tiers drop from the smallest 4, after the owner found the first tuning
// a little too easy; D106), a careful (greedy) player rarely reaches the 600-drop cap,
// and scores spread widely. The owner's shop has 8 tiers (5 products + 3 game-only pieces); a shop
// with only 4 gets slightly wider bounds because its chain of tiers is shorter.

import { describe, expect, it } from "vitest";
import { defaultTierDefs, dropTierCount, MAX_DROPS } from "@/lib/game";
import { botRun, greedyRun } from "../support/gameBot";

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

describe.each([
  { name: "8 tiers", ids: ["a", "b", "c", "d", "e", "f", "g", "h"], randomMax: 300, caps: 1 },
  { name: "5 products", ids: ["a", "b", "c", "d", "e"], randomMax: 300, caps: 1 },
  { name: "4 products", ids: ["a", "b", "c", "d"], randomMax: 450, caps: 4 },
])("game length with $name", ({ ids, randomMax, caps }) => {
  const tiers = defaultTierDefs(ids);
  const seeds = Array.from({ length: 20 }, (_, i) => i);

  it("random play ends by piling up: median 35-100 drops, max below the bound", () => {
    const drops = seeds.map((s) => botRun(`r${s}`, tiers, MAX_DROPS).log.length);
    expect(median(drops)).toBeGreaterThanOrEqual(35);
    expect(median(drops)).toBeLessThanOrEqual(100);
    expect(Math.max(...drops)).toBeLessThan(randomMax);
  });

  it("careful play rarely reaches the drop cap and scores spread widely", () => {
    const runs = seeds.map((s) => greedyRun(`g${s}`, tiers, MAX_DROPS));
    expect(runs.filter((r) => r.drops >= MAX_DROPS).length).toBeLessThanOrEqual(caps);
    const scores = runs.map((r) => r.score);
    expect(Math.max(...scores)).toBeGreaterThanOrEqual(3 * Math.min(...scores));
  });
});

describe("drop tiers", () => {
  it("drops from the smallest 3 tiers, 4 once there are 7 or more", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(dropTierCount)).toEqual([1, 2, 3, 3, 3, 3, 4, 4]);
  });
});
