// A deterministic bot for the game engine tests: plays random drops with random gaps.

import { createGame, createRng, hashState, MAX_STEPS, settleGame, type ReplayDrop, type TierDef } from "@/lib/game";

export function botRun(seed: string, tiers: readonly TierDef[], maxDrops: number, height = 1.5) {
  const g = createGame({ seed, tiers, width: 1, height });
  const rng = createRng(`bot:${seed}`);
  const log: ReplayDrop[] = [];
  const hashes: string[] = [];
  while (log.length < maxDrops && !g.over && g.steps < MAX_STEPS - 400) {
    const x = Math.floor(rng.next() * 1000) / 1000;
    const at = g.steps;
    if (g.drop(x) === null) throw new Error("bot: drop refused");
    log.push({ x, at });
    const gap = 30 + rng.int(60);
    for (let i = 0; i < gap && !g.over; i++) g.step();
    if (log.length % 10 === 0) hashes.push(hashState(g.state()));
  }
  settleGame(g);
  return { log, hashes, score: g.score, over: g.over, steps: g.steps, finalHash: hashState(g.state()) };
}
