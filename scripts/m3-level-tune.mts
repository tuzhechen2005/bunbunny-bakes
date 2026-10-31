// Usage: npx tsx scripts/m3-level-tune.mts [weeks=100]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { m3Level } = require("../src/lib/m3") as typeof import("../src/lib/m3");
const { greedyM3, randomM3 } = require("../tests/support/m3Bot") as typeof import("../tests/support/m3Bot");
const weeks = Number(process.argv[2] ?? 100);
if (!Number.isInteger(weeks) || weeks < 1) throw new RangeError("positive week count required");
const levels = process.argv[3] ? process.argv[3].split(",").map(Number) : Array.from({ length: 30 }, (_, i) => i + 1);
for (const n of levels) {
  let wins = 0, casualMoves = 0, casualWins = 0;
  for (let w = 0; w < weeks; w++) {
    const week = new Date(Date.UTC(2026, 0, 5 + w * 7)).toISOString().slice(0, 10);
    const level = m3Level(week, n);
    const tiers = Array.from({ length: level.tierCount }, (_, i) => ({ id: `t${i}` }));
    const bot = greedyM3(level.seed, tiers, level);
    wins += Number(bot.score >= level.target);
    if (n === 1) {
      const casual = randomM3(level.seed, tiers, level);
      if (casual.score >= level.target) { casualWins++; casualMoves += casual.moves.length / level.moves; }
    }
  }
  console.log(`| ${n} | ${(wins / weeks * 100).toFixed(1)}% |`);
  if (n === 1) console.log(`casual L1: pass ${(casualWins / weeks * 100).toFixed(1)}%; mean moves of wins ${(casualMoves / casualWins * 100).toFixed(1)}%`);
}
