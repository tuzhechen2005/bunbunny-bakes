import { expect, it } from "vitest";
import { greedyGrab, randomGrab } from "../support/grabBot";

it("v6 makes L1 accessible and aimed play typically ends at L3–5", () => {
  const tiers = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}` }));
  const random = Array.from({ length: 100 }, (_, i) => randomGrab(`review-1102-${i}`, tiers));
  const greedy = Array.from({ length: 100 }, (_, i) => greedyGrab(`review-1102-${i}`, tiers));
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  expect([...random, ...greedy].every(r => r.over)).toBe(true);
  expect(random.filter(r => r.level >= 2).length).toBeGreaterThanOrEqual(90);
  expect(greedy.filter(r => r.level >= 3 && r.level <= 5).length).toBeGreaterThanOrEqual(90);
  expect(mean(greedy.map(r => r.score))).toBeGreaterThan(mean(random.map(r => r.score)) * 1.8);
  expect(mean(greedy.map(r => r.busyTicks / r.ticks))).toBeLessThan(.674);
  expect(mean(greedy.map(r => r.completedOrders))).toBeGreaterThan(3);
}, 60_000);
