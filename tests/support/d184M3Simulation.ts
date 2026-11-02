/** Independent visible-board strategy; run directly with npx tsx, not as a unit test. */
import { m3Level } from '../../src/lib/m3';
import { greedyM3 } from './m3Bot';
const weeks = Number(process.argv[2] ?? 100);
if (!Number.isSafeInteger(weeks) || weeks < 100) throw new RangeError('at least 100 weeks required');
let previous = 0, maxDrop = 0;
for (let n = 1; n <= 30; n++) {
  let wins = 0;
  for (let w = 0; w < weeks; w++) {
    const week = new Date(Date.UTC(2026, 0, 5 + 7 * w)).toISOString().slice(0, 10);
    const level = m3Level(week, n);
    const tiers = Array.from({ length: level.tierCount }, (_, i) => ({ id: `t${i}` }));
    wins += Number(greedyM3(level.seed, tiers, level).score >= level.target);
  }
  const rate = wins * 100 / weeks;
  const drop = n === 1 ? 0 : previous - rate;
  maxDrop = Math.max(maxDrop, drop);
  console.log(JSON.stringify({ level: n, wins, weeks, passRate: rate, drop }));
  previous = rate;
}
console.log(JSON.stringify({ maxAdjacentDrop: maxDrop, accepted: maxDrop <= 15 }));
if (maxDrop > 15) process.exitCode = 1;
