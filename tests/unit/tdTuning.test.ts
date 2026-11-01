import { expect, it } from "vitest";
import { tdLevel } from "@/lib/td";
import { greedyTd, randomTd, tdBotWeeks } from "../support/tdBot";

it.each([0, 100])("keeps landscape progression and random play inside the tuning bounds (week offset %i)", (offset) => {
  const rates = [1, 3, 5, 10, 20].map(n => {
    const weeks = tdBotWeeks(100, offset);
    const greedy = weeks.map(week => greedyTd(tdLevel(week, n)));
    const random = n === 1 ? weeks.map(week => randomTd(tdLevel(week, n)).state) : [];
    const rate = {
      level: n, greedy: greedy.filter(s => s.state.passed).length,
      random: n === 1 ? random.filter(s => s.passed).length : null,
      sifters: greedy.filter(s => s.inputs.some(i => i.type === "place" && i.tower === "flourSifter")).length,
    };
    process.stdout.write(`TD checkpoint: ${JSON.stringify({ offset, ...rate })}\n`);
    return rate;
  });
  process.stdout.write(`TD passes / 100 weeks: ${JSON.stringify(rates)}\n`);
  for (const rate of rates) expect(rate.sifters).toBeGreaterThanOrEqual(90);
  expect(rates[0].greedy).toBe(100);
  expect(rates[0].random).toBeGreaterThanOrEqual(30);
  for (const [index, target] of [[1, 90], [2, 75], [3, 50], [4, 20]]) {
    expect(rates[index].greedy).toBeGreaterThanOrEqual(target - 10);
    expect(rates[index].greedy).toBeLessThanOrEqual(target + 10);
  }
}, 600_000);
