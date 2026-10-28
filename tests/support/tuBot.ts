// Deterministic bots for the 兔了个兔 engine: a random tapper and a simple greedy one.

import { createRng } from "@/lib/game/rng";
import { BAG_SIZE, createTuGame, MAX_TAPS, type TuState, type TuTap, type TuTierInput } from "@/lib/tu";

export interface TuBotResult {
  taps: TuTap[];
  score: number;
  batch: number;
  over: boolean;
}

type Picker = (s: TuState, pick: (n: number) => number) => number;

function run(seed: string, tiers: readonly TuTierInput[], picker: Picker, maxTaps = MAX_TAPS): TuBotResult {
  const g = createTuGame({ seed, tiers });
  const rng = createRng(`tubot:${seed}`);
  const taps: TuTap[] = [];
  let at = 0;
  while (!g.over && taps.length < maxTaps) {
    const id = picker(g.state(), (n) => rng.int(n));
    at += 150 + rng.int(900);
    if (g.tap(id) === null) throw new Error("tubot: tap refused");
    taps.push({ id, at });
  }
  return { taps, score: g.score, batch: g.batch, over: g.over };
}

/** Taps any free tile at random (a player who does not look). */
export function randomTu(seed: string, tiers: readonly TuTierInput[], maxTaps?: number): TuBotResult {
  return run(
    seed,
    tiers,
    (s, pick) => {
      const free = s.tiles.filter((t) => t.free);
      return free[pick(free.length)].id;
    },
    maxTaps,
  );
}

/**
 * Greedy but simple: finish what is in the bag, start a bread only when 3 of it are in reach,
 * never fill the bag without a pack if another move exists, prefer order breads. No lookahead
 * under covered tiles.
 */
export function greedyTu(seed: string, tiers: readonly TuTierInput[], maxTaps?: number): TuBotResult {
  return run(
    seed,
    tiers,
    (s, pick) => {
      const free = s.tiles.filter((t) => t.free);
      const inBag = (tier: number) => s.bag.filter((b) => b === tier).length;
      const freeOf = (tier: number) => free.filter((t) => t.tier === tier).length;
      let best = -Infinity;
      let picks: number[] = [];
      for (const t of free) {
        const c = inBag(t.tier);
        const packs = c === 2;
        const fatal = !packs && s.bag.length + 1 >= BAG_SIZE;
        const score =
          (packs ? 1000 : 0) +
          (fatal ? -10000 : 0) +
          c * 100 +
          (c + freeOf(t.tier) >= 3 ? 50 : 0) +
          freeOf(t.tier) * 5 +
          (s.orders.includes(t.tier) ? 3 : 0);
        if (score > best) {
          best = score;
          picks = [t.id];
        } else if (score === best) picks.push(t.id);
      }
      return picks[pick(picks.length)];
    },
    maxTaps,
  );
}
