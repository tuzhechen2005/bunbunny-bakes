import { greedyGrab, randomGrab } from "../tests/support/grabBot";

const count = Number(process.argv[2] ?? 200);
const tierCount = Number(process.argv[3] ?? 6);
const prefix = process.argv[4] ?? "grab-tune";
const tiers = Array.from({ length: tierCount }, (_, i) => ({ id: `t${i}` }));
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const runs = [randomGrab, greedyGrab].map((bot) => Array.from({ length: count }, (_, i) => bot(`${prefix}${i}`, tiers)));
console.table(runs.map((run, i) => ({
  bot: i === 0 ? "random" : "greedy", seeds: count, tiers: tierCount,
  level: mean(run.map(r => r.level)), levels: JSON.stringify(run.reduce((a, r) => { a[r.level] = (a[r.level] ?? 0) + 1; return a; }, {} as Record<number, number>)),
  orders: mean(run.map(r => r.completedOrders)), seconds: mean(run.map(r => r.ticks / 60)), busy: mean(run.map(r => r.busyTicks / r.ticks)), maxBusy: mean(run.map(r => r.maxBusyTicks / 60)),
  score: mean(run.map((r) => r.score)), grabs: mean(run.map((r) => r.grabs)),
  launches: mean(run.map((r) => r.launchesAccepted)),
})));
console.log("random / greedy:", mean(runs[0].map((r) => r.score)) / mean(runs[1].map((r) => r.score)));
