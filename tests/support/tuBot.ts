// Deterministic bots for the 兔了个兔 engine: a random tapper and a simple greedy one.
// Both are information-limited (D128): they only see what the player sees, i.e. visible tiles
// (hidden tiles are removed from their view before they choose), the bag and the orders.

import { createRng } from "@/lib/game/rng";
import { BAG_SIZE, createTuGame, MAX_TAPS, type TuState, type TuTap, type TuTierInput } from "@/lib/tu";

export interface TuBotResult {
  taps: TuTap[];
  score: number;
  batch: number;
  over: boolean;
}

type Picker = (s: TuState, pick: (n: number) => number) => number;

/** What a player can see: the state without the hidden tiles. */
export function playerView(s: TuState): TuState {
  return { ...s, tiles: s.tiles.filter((t) => t.visible) };
}

function run(seed: string, tiers: readonly TuTierInput[], picker: Picker, maxTaps = MAX_TAPS): TuBotResult {
  const g = createTuGame({ seed, tiers });
  const rng = createRng(`tubot:${seed}`);
  const taps: TuTap[] = [];
  let at = 0;
  while (!g.over && taps.length < maxTaps) {
    const id = picker(playerView(g.state()), (n) => rng.int(n));
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

function greedyPicker(dig: number): Picker {
  return (s, pick) => {
    const free = s.tiles.filter((t) => t.free);
    const inBag = (tier: number) => s.bag.filter((b) => b === tier).length;
    const freeOf = (tier: number) => free.filter((t) => t.tier === tier).length;
    const seenOf = (tier: number) => s.tiles.filter((t) => !t.free && t.tier === tier).length;
    const coversSeen = (t: TuState["tiles"][number]) =>
      s.tiles.filter((o) => o.layer < t.layer && Math.abs(o.x - t.x) < 1 && Math.abs(o.y - t.y) < 1).length;
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
        seenOf(t.tier) +
        (dig > 0 ? dig * coversSeen(t) : 0) +
        (s.orders.includes(t.tier) ? 3 : 0);
      if (score > best) {
        best = score;
        picks = [t.id];
      } else if (score === best) picks.push(t.id);
    }
    return picks[pick(picks.length)];
  };
}

/**
 * Greedy but simple (the tuning reference, D128): finish what is in the bag, start a bread only
 * when 3 of it are in reach, never fill the bag without a pack if another move exists, prefer
 * order breads. Looks only at visible tiles: free ones count fully, partly covered ones a little.
 */
export function greedyTu(seed: string, tiers: readonly TuTierInput[], maxTaps?: number): TuBotResult {
  return run(seed, tiers, greedyPicker(0), maxTaps);
}

/** Greedy plus digging: among similar moves, prefers tiles lying on many visible tiles (a stronger player). */
export function diggerTu(seed: string, tiers: readonly TuTierInput[], maxTaps?: number): TuBotResult {
  return run(seed, tiers, greedyPicker(2), maxTaps);
}
