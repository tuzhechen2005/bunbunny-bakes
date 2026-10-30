// Usage: npx tsx scripts/m3-tune.mts [seeds=1000] [tierCount=6]
import { createRequire } from "node:module";
// This repository has no package-level ESM flag; load its TS modules through tsx's CJS hook.
const require = createRequire(import.meta.url);
const m3 = require("../src/lib/m3") as typeof import("../src/lib/m3");
const { CELL_POINTS, ROLL_POINTS, BIG_POINTS, MAX_CHAIN_MULTIPLIER, ORDER_MIN_NEED, ORDER_MAX_NEED, ORDER_POINTS_PER_TILE } = m3;
const bots = require("../tests/support/m3Bot") as typeof import("../tests/support/m3Bot");
const { randomM3, greedyM3 } = bots;

const seeds = Number(process.argv[2] ?? 1000);
const tierCount = Number(process.argv[3] ?? 6);
if (!Number.isSafeInteger(seeds) || seeds < 1 || !Number.isSafeInteger(tierCount) || tierCount < 4) {
  throw new RangeError("usage: m3-tune.mts [positive integer seeds] [tierCount >= 4]");
}
const tiers = Array.from({ length: tierCount }, (_, i) => ({ id: `t${i}` }));
const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
console.log(`seeds=${seeds} tiers=${tierCount} (first ${Math.min(6, tierCount)} used); seeds m3-tune0..m3-tune${seeds - 1}`);
console.log(JSON.stringify({ CELL_POINTS, ROLL_POINTS, BIG_POINTS, MAX_CHAIN_MULTIPLIER, ORDER_MIN_NEED, ORDER_MAX_NEED, ORDER_POINTS_PER_TILE }));
console.log("bot | score p10 | p50 | p90 | specials/game | fired/game | converted/game | reshuffles/game");
for (const [name, bot] of [["random", randomM3], ["greedy", greedyM3]] as const) {
  const runs = Array.from({ length: seeds }, (_, i) => bot(`m3-tune${i}`, tiers));
  if (runs.some((r) => !r.over || r.moves.length !== 30)) throw new Error("unfinished tuning run");
  const scores = runs.map((r) => r.score).sort((a, b) => a - b);
  const mean = (field: "specials" | "fired" | "converted" | "reshuffles") => (runs.reduce((sum, r) => sum + r[field], 0) / seeds).toFixed(3);
  console.log(`${name} | ${[0.1, 0.5, 0.9].map((p) => percentile(scores, p)).join(" | ")} | ${["specials", "fired", "converted", "reshuffles"].map((f) => mean(f as Parameters<typeof mean>[0])).join(" | ")}`);
}
