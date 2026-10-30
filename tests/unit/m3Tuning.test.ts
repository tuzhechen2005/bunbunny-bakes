import { expect, it } from "vitest";
import { randomM3, greedyM3 } from "../support/m3Bot";

const tiers = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}` }));
const median = (scores: number[]) => scores.sort((a, b) => a - b)[Math.floor(scores.length / 2)];

it("visible-board greedy play clearly beats random play over 100 fixed seeds", () => {
  const random = Array.from({ length: 100 }, (_, i) => randomM3(`m3-tune${i}`, tiers));
  const greedy = Array.from({ length: 100 }, (_, i) => greedyM3(`m3-tune${i}`, tiers));
  expect([...random, ...greedy].every((r) => r.over && r.moves.length === 30)).toBe(true);
  expect(median(greedy.map((r) => r.score))).toBeGreaterThan(median(random.map((r) => r.score)) * 1.35);
  expect(greedy.reduce((sum, r) => sum + r.specials, 0)).toBeGreaterThan(random.reduce((sum, r) => sum + r.specials, 0) * 2);
}, 30_000);
