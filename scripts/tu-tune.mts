// 兔了个兔 tuning: plays the (information-limited) bots over many seeds and prints how far they get.
// Usage: npx tsx scripts/tu-tune.mts [seeds=200] [tierCount=8]

import { BATCHES, dealBatch, isHidden } from "../src/lib/tu/deal";
import { diggerTu, greedyTu, randomTu, type TuBotResult } from "../tests/support/tuBot";
import type { TuTierInput } from "../src/lib/tu";

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
const hiddenShare = [...BATCHES, BATCHES[BATCHES.length - 1]].map((_, i) => {
  let hidden = 0;
  let all = 0;
  for (let s = 0; s < 100; s++) {
    const { tiles } = dealBatch(`hid${s}`, tierCount, i + 1);
    all += tiles.length;
    hidden += tiles.filter((t) => isHidden(t, tiles)).length;
  }
  return `${i + 1}:${Math.round((100 * hidden) / all)}%`;
});
console.log(`hidden at deal (per batch) ${hiddenShare.join(" ")}`);
const bots: [string, (seed: string, tiers: readonly TuTierInput[]) => TuBotResult][] = [
  ["random", (s, t) => randomTu(s, t)],
  ["greedy-noprops", (s, t) => greedyTu(s, t, { props: false })],
  ["greedy", (s, t) => greedyTu(s, t)],
  ["digger", (s, t) => diggerTu(s, t)],
];
for (const [name, bot] of bots) {
  const runs = Array.from({ length: seeds }, (_, i) => bot(`tune${i}`, tiers));
  const batch = runs.map((r) => r.batch);
  const score = runs.map((r) => r.score);
  const taps = runs.map((r) => r.taps.length);
  const props = runs.map((r) => r.taps.filter((e) => "p" in e).length);
  console.log(
    `${name.padEnd(14)} batch p10/p50/p90 ${pct(batch, 0.1)}/${pct(batch, 0.5)}/${pct(batch, 0.9)} [${hist(batch)}]` +
      ` | score p10/p50/p90 ${pct(score, 0.1)}/${pct(score, 0.5)}/${pct(score, 0.9)} max ${Math.max(...score)}` +
      ` | taps p50 ${pct(taps, 0.5)} | props used p50 ${pct(props, 0.5)}`,
  );
}
