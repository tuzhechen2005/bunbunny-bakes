import { expect, it } from "vitest";
import { greedyGrab, randomGrab } from "../support/grabBot";

it("forgiving v4 keeps a strategy advantage and 18–26 greedy grabs over 200 seeds", () => {
  const tiers = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}` }));
  const random = Array.from({ length: 200 }, (_, i) => randomGrab(`grab-tune${i}`, tiers));
  const greedy = Array.from({ length: 200 }, (_, i) => greedyGrab(`grab-tune${i}`, tiers));
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const ratio = mean(random.map((r) => r.score)) / mean(greedy.map((r) => r.score));
  expect([...random, ...greedy].every((r) => r.over)).toBe(true);
  expect(ratio).toBeGreaterThanOrEqual(0.45);
  expect(ratio).toBeLessThanOrEqual(0.65);
  const grabs = mean(greedy.map((r) => r.grabs));
  expect(grabs).toBeGreaterThanOrEqual(18);
  expect(grabs).toBeLessThanOrEqual(26);
}, 30_000);
