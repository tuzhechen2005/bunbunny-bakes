// Deterministic bots for the 兔了个兔 engine: a random tapper and a simple greedy one.
// All are information-limited (D128): they only see what the player sees, i.e. visible tiles
// (hidden tiles are removed from their view before they choose), the bag, the orders and the
// props. Only right after a "peek" do they see the whole board, for that one decision.

import { createRng } from "@/lib/game/rng";
import { createTuGame, MAX_TAPS, type TuLogEntry, type TuProp, type TuState, type TuTap, type TuTierInput } from "@/lib/tu";

export interface TuBotResult<E extends TuLogEntry = TuLogEntry> {
  taps: E[];
  score: number;
  batch: number;
  over: boolean;
}

export interface TuBotOptions {
  maxTaps?: number;
  /** Use props sensibly (default true for the greedy bots; the random bot never uses them). */
  props?: boolean;
}

type Choice = { id: number } | { p: TuProp };
type Picker = (s: TuState, pick: (n: number) => number, peeked: boolean) => Choice;

/** What a player can see: the state without the hidden tiles. */
export function playerView(s: TuState): TuState {
  return { ...s, tiles: s.tiles.filter((t) => t.visible) };
}

function run(seed: string, tiers: readonly TuTierInput[], picker: Picker, maxTaps = MAX_TAPS): TuBotResult {
  const g = createTuGame({ seed, tiers });
  const rng = createRng(`tubot:${seed}`);
  const taps: TuLogEntry[] = [];
  let at = 0;
  let peeked = false;
  while (!g.over && taps.length < maxTaps) {
    const s = g.state();
    const c = picker(peeked ? s : playerView(s), (n) => rng.int(n), peeked);
    at += 150 + rng.int(900);
    if ("p" in c) {
      if (g.use(c.p) === null) throw new Error("tubot: prop refused");
      peeked = c.p === "peek";
      taps.push({ p: c.p, at });
    } else {
      if (g.tap(c.id) === null) throw new Error("tubot: tap refused");
      peeked = false;
      taps.push({ id: c.id, at });
    }
  }
  return { taps, score: g.score, batch: g.batch, over: g.over };
}

/** Taps any free tile at random (a player who does not look); never uses props. */
export function randomTu(seed: string, tiers: readonly TuTierInput[], maxTaps?: number): TuBotResult<TuTap> {
  return run(
    seed,
    tiers,
    (s, pick) => {
      const free = s.tiles.filter((t) => t.free);
      return { id: free[pick(free.length)].id };
    },
    maxTaps,
  ) as TuBotResult<TuTap>;
}

function greedyPicker(dig: number, useProps: boolean): Picker {
  return (s, pick, peeked) => {
    const free = s.tiles.filter((t) => t.free);
    const inBag = (tier: number) => s.bag.filter((b) => b === tier).length;
    const freeOf = (tier: number) => free.filter((t) => t.tier === tier).length;
    const seenOf = (tier: number) => s.tiles.filter((t) => !t.free && t.tier === tier).length;
    const coversSeen = (t: TuState["tiles"][number]) =>
      s.tiles.filter((o) => o.layer < t.layer && Math.abs(o.x - t.x) < 1 && Math.abs(o.y - t.y) < 1).length;
    let best = -Infinity;
    let picks: number[] = [];
    let bestFatal = false;
    for (const t of free) {
      const c = inBag(t.tier);
      const packs = c === 2;
      const fatal = !packs && s.bag.length + 1 >= s.bagSize;
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
        bestFatal = fatal;
      } else if (score === best) picks.push(t.id);
    }
    if (useProps) {
      // About to lose: one more slot first, else a look at the hidden tiles before the risky move.
      if (bestFatal && s.props.bag > 0 && s.bagSize === 6) return { p: "bag" };
      const risky = best < 1000 && s.bag.length + 2 >= s.bagSize;
      if (risky && !peeked && s.props.peek > 0) return { p: "peek" };
      // Neither order can be seen anywhere (board or bag): ask for new ones.
      const seen = new Set([...s.tiles.map((t) => t.tier), ...s.bag]);
      if (s.props.swap > 0 && !peeked && !seen.has(s.orders[0]) && !seen.has(s.orders[1])) return { p: "swap" };
    }
    return { id: picks[pick(picks.length)] };
  };
}

/**
 * Greedy but simple (the tuning reference, D128/D130): finish what is in the bag, start a bread
 * only when 3 of it are in reach, never fill the bag without a pack if another move exists,
 * prefer order breads. Looks only at visible tiles: free ones count fully, partly covered ones a
 * little. With props (default): the extra slot when the only moves left would end the game, a
 * peek before a risky move, new orders when neither can be seen.
 */
export function greedyTu(seed: string, tiers: readonly TuTierInput[], opts: TuBotOptions & { props: false }): TuBotResult<TuTap>;
export function greedyTu(seed: string, tiers: readonly TuTierInput[], opts?: TuBotOptions | number): TuBotResult;
export function greedyTu(seed: string, tiers: readonly TuTierInput[], opts: TuBotOptions | number = {}): TuBotResult {
  const o = typeof opts === "number" ? { maxTaps: opts } : opts;
  return run(seed, tiers, greedyPicker(0, o.props ?? true), o.maxTaps);
}

/** Greedy plus digging: among similar moves, prefers tiles lying on many visible tiles (a stronger player). */
export function diggerTu(seed: string, tiers: readonly TuTierInput[], opts: TuBotOptions & { props: false }): TuBotResult<TuTap>;
export function diggerTu(seed: string, tiers: readonly TuTierInput[], opts?: TuBotOptions | number): TuBotResult;
export function diggerTu(seed: string, tiers: readonly TuTierInput[], opts: TuBotOptions | number = {}): TuBotResult {
  const o = typeof opts === "number" ? { maxTaps: opts } : opts;
  return run(seed, tiers, greedyPicker(2, o.props ?? true), o.maxTaps);
}
