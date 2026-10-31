import { expect, it } from "vitest";
import { tdLevel } from "@/lib/td";
import { greedyTd, randomTd, tdBotWeeks } from "../support/tdBot";

it.each([0, 100])("keeps landscape progression and random play inside the tuning bounds (week offset %i)", (offset) => {
  const rates = [1, 3, 10, 20].map(n => {
    const weeks = tdBotWeeks(100, offset);
    const greedy = weeks.map(week => greedyTd(tdLevel(week, n)));
    const random = weeks.map(week => randomTd(tdLevel(week, n)).state);
    return {
      level: n, greedy: greedy.filter(s => s.state.passed).length,
      random: random.filter(s => s.passed).length,
      sifters: greedy.filter(s => s.inputs.some(i => i.type === "place" && i.tower === "flourSifter")).length,
    };
  });
  process.stdout.write(`TD passes / 100 weeks: ${JSON.stringify(rates)}\n`);
  expect(rates[0].greedy).toBeGreaterThanOrEqual(95);
  expect(rates[1].greedy).toBeGreaterThanOrEqual(60);
  expect(rates[1].greedy).toBeLessThanOrEqual(80);
  expect(rates[2].greedy).toBeGreaterThanOrEqual(20);
  expect(rates[2].greedy).toBeLessThanOrEqual(40);
  expect(rates[3].greedy).toBeGreaterThanOrEqual(5);
  expect(rates[3].greedy).toBeLessThanOrEqual(10);
  for (const rate of rates.slice(1)) expect(rate.random).toBeLessThanOrEqual(3);
  for (const rate of rates) expect(rate.sifters).toBeGreaterThanOrEqual(90);
}, 600_000);
