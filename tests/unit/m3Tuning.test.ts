import { expect, it } from "vitest";
import { randomM3, greedyM3 } from "../support/m3Bot";
import { BIG_POINTS, MAX_CASCADE_STEPS, ORDER_MAX_NEED, ORDER_MIN_NEED, REFILL_BIAS_PERCENT, ROLL_POINTS } from "@/lib/m3";

const tiers = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}` }));

it("S8 keeps cascade targets and records easier order completion over 300 fixed seeds", () => {
  expect([ORDER_MIN_NEED, ORDER_MAX_NEED, ROLL_POINTS, BIG_POINTS, REFILL_BIAS_PERCENT]).toEqual([18, 24, 100, 200, 20]);
  const random = Array.from({ length: 300 }, (_, i) => randomM3(`m3-tune${i}`, tiers));
  const greedy = Array.from({ length: 300 }, (_, i) => greedyM3(`m3-tune${i}`, tiers));
  expect([...random, ...greedy].every((r) => r.over && r.moves.length === 30)).toBe(true);
  expect(greedy.reduce((sum, r) => sum + r.specials, 0)).toBeGreaterThan(random.reduce((sum, r) => sum + r.specials, 0) * 2);
  const sum = (runs: typeof greedy, field: "clears" | "movesWithThreeClears" | "ordersCompleted") => runs.reduce((n, r) => n + r[field], 0);
  const moves = greedy.reduce((n, r) => n + r.moves.length, 0);
  expect(sum(greedy, "clears") / moves).toBeGreaterThanOrEqual(1.7);
  expect(sum(greedy, "clears") / moves).toBeLessThanOrEqual(2.0);
  expect(sum(greedy, "movesWithThreeClears") / moves).toBeGreaterThanOrEqual(.22);
  expect(sum(greedy, "movesWithThreeClears") / moves).toBeLessThanOrEqual(.28);
  // Score ratios are recorded by m3-tune, not constrained: prioritize easier orders.
  // The specified settings yield 3.79, above the approximate 2–3 goal; pin the
  // measurement without claiming the goal was met or silently retuning needs.
  expect(sum(greedy, "ordersCompleted") / greedy.length).toBeCloseTo(3.79, 2);
  expect(Math.max(...[...random, ...greedy].map((r) => r.maxChain))).toBeLessThanOrEqual(MAX_CASCADE_STEPS);
}, 30_000);
