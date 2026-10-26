// Deterministic bots for the game engine tests: a random one and a simple greedy one.

import {
  createGame,
  createRng,
  hashState,
  MAX_STEPS,
  settleGame,
  type Game,
  type ReplayDrop,
  type TierDef,
} from "@/lib/game";

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

/** Aims over the topmost body of the same tier, else over the lowest part of the pile. */
function greedyX(g: Game, tiers: readonly TierDef[]): number {
  const s = g.state();
  const hand = g.nextPiece();
  const r = tiers[hand].radius;
  let best: { x: number; y: number } | null = null;
  for (const b of s.bodies) if (b.tier === hand && (!best || b.y < best.y)) best = { x: b.x, y: b.y };
  if (best) return Math.floor(best.x * 1000) / 1000;
  let bx = 0.5;
  let by = -1;
  for (let k = 0; k <= 10; k++) {
    const x = r + ((1 - 2 * r) * k) / 10;
    let top = s.height;
    for (const b of s.bodies) if (Math.abs(b.x - x) < b.r + r) top = Math.min(top, b.y - b.r);
    if (top > by) {
      by = top;
      bx = x;
    }
  }
  return Math.floor(bx * 1000) / 1000;
}

/** Plays like a casual human: aims, drops about every `gapSteps` steps (60 = 0.5 s). */
export function greedyRun(seed: string, tiers: readonly TierDef[], maxDrops: number, gapSteps = 60, height = 1.5) {
  const g = createGame({ seed, tiers, width: 1, height });
  const log: ReplayDrop[] = [];
  while (log.length < maxDrops && !g.over) {
    const x = greedyX(g, tiers);
    const at = g.steps;
    if (g.drop(x) === null) throw new Error("greedy: drop refused");
    log.push({ x, at });
    for (let i = 0; i < gapSteps && !g.over; i++) g.step();
  }
  settleGame(g);
  return { log, score: g.score, over: g.over, steps: g.steps, drops: log.length, finalHash: hashState(g.state()), seedIndex: seed.replace(/^cap/, "") };
}
