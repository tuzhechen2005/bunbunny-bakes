import { expect, it } from "vitest";
import { tdLevel } from "@/lib/td";
import { greedyTd, randomTd, tdBotWeeks } from "../support/tdBot";

it("keeps greedy progression and random play inside the agreed tuning bounds", () => {
  const rates = [1, 10, 20].map(n => {
    const weeks = tdBotWeeks(100);
    const greedy = weeks.map(week => greedyTd(tdLevel(week, n)).state);
    const random = weeks.map(week => randomTd(tdLevel(week, n)).state);
    return { level: n, greedy: greedy.filter(s => s.passed).length, random: random.filter(s => s.passed).length };
  });
  process.stdout.write(`TD passes / 100 weeks: ${JSON.stringify(rates)}\n`);
  expect(rates[0].greedy).toBeGreaterThanOrEqual(98);
  expect(rates[1].greedy).toBeGreaterThanOrEqual(35);
  expect(rates[1].greedy).toBeLessThanOrEqual(65);
  expect(rates[2].greedy).toBeLessThan(15);
  expect(rates[1].random).toBeLessThanOrEqual(15);
  expect(rates[1].random).toBeLessThanOrEqual(rates[1].greedy - 20);
  // L1 intentionally remains forgiving to beginners, including random purchasers.
  expect(rates.reduce((sum, r) => sum + r.random, 0)).toBeLessThan(rates.reduce((sum, r) => sum + r.greedy, 0) * 0.75);
}, 120_000);
