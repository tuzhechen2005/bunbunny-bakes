// 兔了个兔 tuning: plays the random and greedy bots over many seeds and prints how far they get.
// Usage: npx tsx scripts/tu-tune.mts [seeds=200] [tierCount=8]

import { BATCHES } from "../src/lib/tu/deal";
import { greedyTu, randomTu } from "../tests/support/tuBot";

const seeds = Number(process.argv[2] ?? 200);
const tierCount = Number(process.argv[3] ?? 8);
const tiers = Array.from({ length: tierCount }, (_, i) => ({ id: `t${i}` }));

const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const hist = (a: number[]) => {
  const h = new Map<number, number>();
  for (const v of a) h.set(v, (h.get(v) ?? 0) + 1);
  return [...h.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
};

console.log(`seeds=${seeds} tiers=${tierCount}`);
console.log(`batches=${JSON.stringify(BATCHES)}`);
for (const [name, bot] of [
  ["random", randomTu],
  ["greedy", greedyTu],
] as const) {
  const runs = Array.from({ length: seeds }, (_, i) => bot(`tune${i}`, tiers));
  const batch = runs.map((r) => r.batch);
  const score = runs.map((r) => r.score);
  const taps = runs.map((r) => r.taps.length);
  console.log(
    `${name.padEnd(6)} batch reached p10/p50/p90 ${pct(batch, 0.1)}/${pct(batch, 0.5)}/${pct(batch, 0.9)} [${hist(batch)}]` +
      ` | score p10/p50/p90 ${pct(score, 0.1)}/${pct(score, 0.5)}/${pct(score, 0.9)} max ${Math.max(...score)}` +
      ` | taps p50 ${pct(taps, 0.5)}`,
  );
}
