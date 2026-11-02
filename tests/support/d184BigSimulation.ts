import { bigSeed, createGame, defaultTierDefs, hashState } from '../../src/lib/game';
import { greedyRun } from './gameBot';
const tiers = defaultTierDefs(Array.from({ length: 8 }, (_, i) => `${i}`));
let matched = 0;
for (let i = 0; i < 100; i++) {
  const seed = i.toString(16);
  const baseline = greedyRun(seed, tiers, 600, 180);
  const g = createGame({ seed: bigSeed(seed), tiers, width: 1, height: 1.5 });
  for (const d of baseline.log) {
    while (g.steps < d.at) g.step();
    g.drop(d.x);
  }
  while (g.steps < baseline.steps) g.step();
  if (g.score !== baseline.score || hashState(g.state()) !== baseline.finalHash) throw new Error(`physics diverged ${i}`);
  matched++;
}
console.log(JSON.stringify({ seeds: 100, identicalScoreAndPhysics: matched }));
