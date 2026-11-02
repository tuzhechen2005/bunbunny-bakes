// npx tsx tests/support/d187TuSimulation.ts [--compare]
// Same bots, seeds and full 20,000-input budget for all revisions; no witness access.
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { greedyTu, diggerTu } from "./tuBot";
import { BATCHES, dealBatch, isHidden, MAX_OVENS, tuScoreMultiplier } from "../../src/lib/tu";

if (process.argv.includes("--compare")) {
  for (const revision of ["129f482^", "129f482"]) {
    const dir = mkdtempSync(join(tmpdir(), "tu-d187-"));
    try {
      for (const file of ["src/lib/tu/engine.ts", "src/lib/tu/deal.ts", "src/lib/tu/index.ts", "src/lib/tu/replay.ts", "src/lib/game/rng.ts", ...(revision === "129f482" ? ["src/lib/tu/planning.ts"] : [])]) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), execFileSync("git", ["show", `${revision}:${file}`]));
      }
      mkdirSync(join(dir, "tests/support"), { recursive: true });
      writeFileSync(join(dir, "tests/support/tuBot.ts"), readFileSync("tests/support/tuBot.ts", "utf8").replaceAll("@/lib/", "../../src/lib/"));
      // Reuse this exact measurement loop with the archived engine and the same current bots.
      const source = readFileSync("tests/support/d187TuSimulation.ts", "utf8");
      writeFileSync(join(dir, "sim.ts"), 'import {greedyTu,diggerTu} from "./tests/support/tuBot";\n' + source.slice(source.indexOf("\nconst tiers ="), source.lastIndexOf("\n// Layout measurements")));
      console.log(`revision=${revision}`);
      console.log(execFileSync("npx", ["tsx", join(dir, "sim.ts")], { encoding: "utf8" }));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}
console.log("revision=working-tree");
const tiers = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}` }));
for (const [name, bot] of [["casual", greedyTu], ["strategy", diggerTu]] as const) {
  const runs = Array.from({ length: 200 }, (_, i) => bot(`tune${i}`, tiers));
  const pct = (key: "score" | "batch", p: number) => runs.map(r => r[key]).sort((a, b) => a - b)[Math.floor(runs.length * p)];
  console.log(JSON.stringify({ name, score: [.1, .5, .9, .99].map(p => pct("score", p)), maxScore: Math.max(...runs.map(r => r.score)), oven: [.1, .5, .9, .99].map(p => pct("batch", p)), hist: runs.reduce((a, r) => { a[r.batch] = (a[r.batch] ?? 0) + 1; return a; }, {} as Record<number, number>), cap: runs.filter(r => r.taps.length >= 20_000).length }));
}
// Layout measurements and a conservative score ceiling (every pack fills an order).
console.log("hidden", BATCHES.map((_, i) => {
  let hidden = 0, count = 0;
  for (let s = 0; s < 100; s++) {
    const { tiles } = dealBatch(`hid${s}`, 8, i + 1);
    hidden += tiles.filter(t => isHidden(t, tiles)).length;
    count += tiles.length;
  }
  return Math.round(hidden / count * 100);
}));
console.log("score upper bound", Array.from({ length: MAX_OVENS }, (_, i) => (dealBatch("bound", 8, i + 1).tiles.length / 3 * 40 + 100) * tuScoreMultiplier(i + 1)).reduce((a, b) => a + b, 0) + 6 * 50 * MAX_OVENS);
