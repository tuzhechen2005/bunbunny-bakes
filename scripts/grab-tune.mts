import { greedyGrab, randomGrab } from "../tests/support/grabBot";

const count = Number(process.argv[2] ?? 200);
const tierCount = Number(process.argv[3] ?? 6);
const prefix = process.argv[4] ?? "grab-tune";
const tiers = Array.from({ length: tierCount }, (_, i) => ({ id: `t${i}` }));
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const runs = [randomGrab, greedyGrab].map((bot) => Array.from({ length: count }, (_, i) => bot(`${prefix}${i}`, tiers)));
console.table(runs.map((run, i) => ({
  bot: i === 0 ? "random" : "greedy", seeds: count, tiers: tierCount,
  score: mean(run.map((r) => r.score)), grabs: mean(run.map((r) => r.grabs)),
  launches: mean(run.map((r) => r.launchesAccepted)),
})));
console.log("random / greedy:", mean(runs[0].map((r) => r.score)) / mean(runs[1].map((r) => r.score)));
