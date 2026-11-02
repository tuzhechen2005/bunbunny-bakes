// D187 game-feel regression: 200 seeded, information-limited bots with the owner's eight kinds.
// Casual greedy play usually ends at ovens 3–4; strategy digging usually ends at 5–6.
// Changing BATCHES, BAG_SIZE, props or the generator moves these distributions.

import { describe, expect, it } from "vitest";
import { createTuGame, MAX_TAPS } from "@/lib/tu";
import { diggerTu, greedyTu, playerView, randomTu } from "../support/tuBot";

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

  it("greedy play with props reaches the gradual middle ovens without hitting the cap", () => {
    const runs = seeds.map((s) => greedyTu(s, TIERS));
    expect(median(runs.map((r) => r.batch))).toBeGreaterThanOrEqual(4);
    expect(median(runs.map((r) => r.batch))).toBeLessThanOrEqual(4);
    expect(runs.filter((r) => r.batch <= 2).length).toBeLessThanOrEqual(0.15 * seeds.length);
    expect(runs.filter((r) => r.batch >= 8).length).toBeLessThanOrEqual(0.2 * seeds.length);
    expect(runs.filter((r) => r.taps.length >= MAX_TAPS)).toEqual([]);
    expect(runs.every((r) => r.taps.some((t) => "p" in t))).toBe(true);
  });

  it("D187 casual ends around 3–4; strategy around 5–6, with bounded scores", () => {
    const casual = seeds.map(s => greedyTu(s, TIERS));
    const strong = seeds.map(s => diggerTu(s, TIERS));
    expect(casual.filter(r => r.batch >= 3 && r.batch <= 4).length).toBeGreaterThan(100);
    expect(strong.filter(r => r.batch >= 5 && r.batch <= 6).length).toBeGreaterThan(100);
    expect(median(strong.map(r => r.score))).toBeGreaterThanOrEqual(10_000);
    expect(median(strong.map(r => r.score))).toBeLessThan(30_000);
    expect(Math.max(...strong.map(r => r.score))).toBeLessThan(100_000);
  });

  it("greedy play without props reaches the middle ovens", () => {
    const runs = seeds.map((s) => greedyTu(s, TIERS, { props: false }));
    const m = median(runs.map((r) => r.batch));
    expect(m >= 2 && m <= 5).toBe(true);
    expect(runs.filter((r) => r.batch >= 7).length).toBeLessThanOrEqual(0.12 * seeds.length);
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
