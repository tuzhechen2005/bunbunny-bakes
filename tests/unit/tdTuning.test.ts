import { expect, it } from "vitest";
import { tdLevel } from "@/lib/td";
import { greedyTd, randomTd, tdBotWeeks } from "../support/tdBot";

// D8 removes the first-call subsidy; retain combat stats and track the v8 baseline.
const checkpoints = [0, 100].flatMap(offset => [[1, 100], [3, 85], [5, 70], [10, 45], [20, 5]]
  .map(([level, target]) => ({ offset, level, target })));

it.each(checkpoints)("keeps level $level inside D8 regression bounds (week offset $offset)", ({ offset, level, target }) => {
  const weeks = tdBotWeeks(100, offset);
  const greedy = weeks.map(week => greedyTd(tdLevel(week, level)));
  const random = level === 1 ? weeks.map(week => randomTd(tdLevel(week, level)).state) : [];
  const rate = {
    level, greedy: greedy.filter(s => s.state.passed).length,
    random: level === 1 ? random.filter(s => s.passed).length : null,
    mix: Object.fromEntries(['rollingPin', 'whisk', 'flourSifter', 'oven'].map(kind => [kind,
      greedy.filter(s => s.inputs.some(i => i.type === 'place' && i.tower === kind)).length])),
    allFour: greedy.filter(s => new Set(s.inputs.filter(i => i.type === 'place').map(i => i.tower)).size === 4).length,
  };
  process.stdout.write(`TD checkpoint: ${JSON.stringify({ offset, ...rate })}\n`);
  expect(rate.mix.flourSifter).toBeGreaterThanOrEqual(90);
  expect(rate.allFour).toBeGreaterThanOrEqual(level === 10 ? 40 : 51);
  if (level === 1) {
    expect(rate.greedy).toBe(100);
    expect(rate.random).toBeGreaterThanOrEqual(50);
  } else {
    expect(rate.greedy).toBeGreaterThanOrEqual(Math.max(1, target - 10));
    expect(rate.greedy).toBeLessThanOrEqual(target + 10);
  }
}, 180_000);
