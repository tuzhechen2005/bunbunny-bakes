// 兔了个兔 engine (D121-D122, D130-D131): a layered tile-matching game with a 6-slot paper bag, two
// customer orders and three props of our own (peek, an extra bag slot, new orders). Pure TS,
// integer maths and the seeded Rng only (no Date.now, no Math.random), so the client and the
// server's replay agree exactly.

import { createRng, type Rng } from "../game/rng";
import { BAG_SIZE, dealBatch, isHidden, overlaps } from "./deal";

export interface TuTierInput {
  id: string;
}

export interface TuTile {
  /** Unique over the whole game (later batches continue the count). */
  id: number;
  /** Index into the `tiers` passed to createTuGame. */
  tier: number;
  /** Top-left corner in tile units (multiples of 0.5); a tile is 1 x 1. See BOARD_W / BOARD_H. */
  x: number;
  y: number;
  /** 0 = bottom. */
  layer: number;
  /** Nothing on a higher layer overlaps it: it can be tapped. */
  free: boolean;
  /**
   * Some part of its square shows: not entirely covered by the union of the tiles on higher
   * layers (D128). A free tile is always visible. The UI must not show a hidden tile's tier
   * (except during a "peek").
   */
  visible: boolean;
}

/** The three props (D131): see the hidden tiles for 3 s, a 7th bag slot for this batch, two new orders. */
export type TuProp = "peek" | "bag" | "swap";
export const TU_PROPS: readonly TuProp[] = ["peek", "bag", "swap"];

export interface TuState {
  /** 1-based 炉. */
  batch: number;
  /** Tiles still on the board, in deal order (bottom layers first). */
  tiles: TuTile[];
  /** Tier per bag slot, at most bagSize, equal tiers kept next to each other. */
  bag: number[];
  /** Tier each customer wants (3 of it). */
  orders: [number, number];
  /** Bonus points each order pays when filled, on top of the pack's points (D132: 「+N」). */
  orderPoints: [number, number];
  /** Props left (D131). */
  props: Record<TuProp, number>;
  /** Bag slots: BAG_SIZE (6), or 7 after the "bag" prop until the next batch is dealt. */
  bagSize: 6 | 7;
  score: number;
  over: boolean;
}

export type TuEvent =
  /** A tile left the board into bag slot `slot` (later slots shift right by one). */
  | { type: "move"; tile: number; tier: number; slot: number }
  /** Three of `tier` at slots slot..slot+2 were packed (later slots shift left by three). `points` includes the order bonus. */
  | { type: "pack"; tier: number; slot: number; points: number; order: boolean }
  /** Tiles that were hidden before this tap and are visible now (after move/pack, before order/batch). */
  | { type: "reveal"; tiles: number[] }
  /** Order `index` now wants `tier`. */
  | { type: "order"; index: 0 | 1; tier: number }
  /** Every PROP_EVERY_ORDERS-th filled order grants one prop (seeded choice). */
  | { type: "gain"; p: TuProp }
  /** Batch `batch` was dealt after the previous one was cleared; `bonus` points for clearing it. */
  | { type: "batch"; batch: number; bonus: number }
  /** A prop was used; `left` of it remain. */
  | { type: "prop"; p: TuProp; left: number }
  /** The bag now has `size` slots: 7 after the "bag" prop, 6 again once a new batch is dealt. */
  | { type: "bagSize"; size: 6 | 7 }
  /** The game ended: PROP_BONUS_POINTS x batch per unused prop (always sent, may be 0), right before `over`. */
  | { type: "bonus"; points: number }
  | { type: "over" };

export interface TuGame {
  state(): TuState;
  /** null = not a tile on the board, covered, or the game is over. */
  tap(tileId: number): TuEvent[] | null;
  /** null = none of it left, the game is over, or not usable ("bag" only once per batch). */
  use(prop: TuProp): TuEvent[] | null;
  readonly over: boolean;
  readonly score: number;
  readonly batch: number;
  /** Accepted log entries so far (tile taps and prop uses). */
  readonly taps: number;
}

export const MIN_TIERS = 2;
export const MAX_TIERS = 8;
/**
 * Rules version (C8). Bump it with every change that alters what a log scores. It is part of every
 * new run's seed (tuSeed), so the server refuses to finish a run dealt under another version, and
 * part of the client's save key, so old saves are dropped.
 */
export const TU_ENGINE_VERSION = 2;
/** The engine ends the game after this many log entries (taps + prop uses), so client and server agree. */
export const MAX_TAPS = 2000;
/** Plausibility for the server: two log entries closer than this (ms) are not a human. */
export const MIN_TAP_GAP_MS = 120;

/** Points per pack, x batch. */
export const PACK_POINTS = 10;
/** Extra points when a pack fills an order, x batch. */
export const ORDER_POINTS = 30;
/** Points for clearing a batch, x that batch's number. */
export const BATCH_POINTS = 100;
/** End bonus per unused prop, x the batch the game ended in (D131). */
export const PROP_BONUS_POINTS = 50;
/** Every this many filled orders grant one prop (D131). */
export const PROP_EVERY_ORDERS = 3;
/** Props of each kind at the start (D131). */
export const START_PROPS = 1;

const SEED_RE = /^v(\d+)\.[0-9a-f]+$/;

/** The seed of a new run: the engine version, a dot, then the server's random hex. */
export function tuSeed(randomHex: string): string {
  return `v${TU_ENGINE_VERSION}.${randomHex}`;
}

/** The engine version a run's seed was made for: 1 for the plain-hex seeds from before versioning. */
export function tuSeedVersion(seed: string): number {
  const m = SEED_RE.exec(seed);
  return m ? Number(m[1]) : 1;
}

interface Live {
  id: number;
  tier: number;
  x2: number;
  y2: number;
  layer: number;
}

export function createTuGame(opts: { seed: string; tiers: readonly TuTierInput[] }): TuGame {
  const seed = String(opts.seed);
  const n = opts.tiers.length;
  if (!Number.isInteger(n) || n < MIN_TIERS || n > MAX_TIERS) throw new RangeError(`tu: needs ${MIN_TIERS}-${MAX_TIERS} tiers`);
  // 消除大面包's 大面包 tier is never a 兔了个兔 bread (D123): a server passing it is a bug.
  if (opts.tiers.some((t) => t.id === "big")) throw new RangeError("tu: the big tier is not a bread tier");

  const orderRng: Rng = createRng(`${seed}:tu:orders`);
  const propRng: Rng = createRng(`${seed}:tu:props`);
  const props: Record<TuProp, number> = { peek: START_PROPS, bag: START_PROPS, swap: START_PROPS };
  let bagSize: 6 | 7 = 6;
  let filled = 0;
  let batch = 0;
  let nextId = 1;
  let board: Live[] = [];
  const bag: number[] = [];
  const orders: [number, number] = [0, 0];
  let score = 0;
  let over = false;
  let taps = 0;

  const deal = () => {
    batch++;
    board = dealBatch(seed, n, batch).tiles.map((t) => ({ id: nextId++, ...t }));
  };
  const isFree = (t: Live) => !board.some((o) => o.layer > t.layer && overlaps(t, o));
  const isVisible = (t: Live) => !isHidden(t, board);
  const boardTiers = () => [...new Set(board.map((t) => t.tier))].sort((a, b) => a - b);

  /**
   * A new order tier from the board, avoiding `avoid` when possible: first all of it, then only
   * avoid[0] (the other order's tier), then any board tier (any tier when the board is empty).
   */
  const pickOrder = (avoid: number[]): number => {
    const on = boardTiers();
    const none = on.filter((t) => !avoid.includes(t));
    const notOther = on.filter((t) => t !== avoid[0]);
    const from = none.length > 0 ? none : notOther.length > 0 ? notOther : on.length > 0 ? on : Array.from({ length: n }, (_, k) => k);
    return from[orderRng.int(from.length)];
  };

  deal();
  orders[0] = pickOrder([]);
  orders[1] = pickOrder([orders[0]]);

  /** Ends the game: the unused-prop bonus, then `over`. */
  const end = (events: TuEvent[]) => {
    over = true;
    const points = PROP_BONUS_POINTS * batch * (props.peek + props.bag + props.swap);
    score += points;
    events.push({ type: "bonus", points }, { type: "over" });
  };

  const state = (): TuState => ({
    batch,
    tiles: board.map((t) => ({ id: t.id, tier: t.tier, x: t.x2 / 2, y: t.y2 / 2, layer: t.layer, free: isFree(t), visible: isVisible(t) })),
    bag: [...bag],
    orders: [orders[0], orders[1]],
    orderPoints: [ORDER_POINTS * batch, ORDER_POINTS * batch],
    props: { ...props },
    bagSize,
    score,
    over,
  });

  const tap = (tileId: number): TuEvent[] | null => {
    if (over) return null;
    const idx = board.findIndex((t) => t.id === tileId);
    if (idx < 0 || !isFree(board[idx])) return null;
    const tile = board[idx];
    // Only tiles under the taken one can become visible; board order keeps the ids in deal order.
    const hiddenUnder = board.filter((o) => o.layer < tile.layer && overlaps(o, tile) && !isVisible(o));
    board.splice(idx, 1);
    const revealed = hiddenUnder.filter(isVisible).map((o) => o.id);
    taps++;
    const events: TuEvent[] = [];

    // Into the bag, right after the last one of the same tier (kept grouped).
    let slot = bag.lastIndexOf(tile.tier) + 1;
    if (slot === 0) slot = bag.length;
    bag.splice(slot, 0, tile.tier);
    events.push({ type: "move", tile: tile.id, tier: tile.tier, slot });

    const first = bag.indexOf(tile.tier);
    if (bag.filter((t) => t === tile.tier).length === 3) {
      bag.splice(first, 3);
      const hit = orders[0] === tile.tier ? 0 : orders[1] === tile.tier ? 1 : -1;
      const points = PACK_POINTS * batch + (hit >= 0 ? ORDER_POINTS * batch : 0);
      score += points;
      events.push({ type: "pack", tier: tile.tier, slot: first, points, order: hit >= 0 });
      if (revealed.length > 0) events.push({ type: "reveal", tiles: revealed });
      let dealt: { batch: number; bonus: number } | null = null;
      if (board.length === 0) {
        // The bag is always empty here: every tier comes in triples per batch.
        const bonus = BATCH_POINTS * batch;
        score += bonus;
        deal();
        dealt = { batch, bonus };
      }
      if (hit >= 0) {
        const i = hit as 0 | 1;
        orders[i] = pickOrder([orders[1 - i]]);
        events.push({ type: "order", index: i, tier: orders[i] });
        filled++;
        if (filled % PROP_EVERY_ORDERS === 0) {
          const p = TU_PROPS[propRng.int(TU_PROPS.length)];
          props[p]++;
          events.push({ type: "gain", p });
        }
      }
      if (dealt) {
        // Orders whose bread is not in the new batch get a new one.
        for (const i of [0, 1] as const) {
          if (!board.some((t) => t.tier === orders[i])) {
            orders[i] = pickOrder([orders[1 - i]]);
            events.push({ type: "order", index: i, tier: orders[i] });
          }
        }
        events.push({ type: "batch", ...dealt });
        // The extra slot lasts one batch; the bag is empty at this point.
        if (bagSize !== BAG_SIZE) {
          bagSize = 6;
          events.push({ type: "bagSize", size: 6 });
        }
      }
    } else {
      if (revealed.length > 0) events.push({ type: "reveal", tiles: revealed });
      if (bag.length >= bagSize) end(events);
    }
    if (!over && taps >= MAX_TAPS) end(events);
    return events;
  };

  const use = (p: TuProp): TuEvent[] | null => {
    if (over || !TU_PROPS.includes(p) || props[p] <= 0) return null;
    if (p === "bag" && bagSize !== BAG_SIZE) return null;
    props[p]--;
    taps++;
    const events: TuEvent[] = [{ type: "prop", p, left: props[p] }];
    if (p === "bag") {
      bagSize = 7;
      events.push({ type: "bagSize", size: 7 });
    } else if (p === "swap") {
      // Two new orders: both different from the old ones and from each other when the board allows it.
      const old: [number, number] = [orders[0], orders[1]];
      orders[0] = pickOrder([old[1], old[0]]);
      orders[1] = pickOrder([orders[0], ...old]);
      events.push({ type: "order", index: 0, tier: orders[0] }, { type: "order", index: 1, tier: orders[1] });
    }
    // "peek" changes nothing here: the UI shows the hidden tiles for 3 s.
    if (taps >= MAX_TAPS) end(events);
    return events;
  };

  return {
    state,
    tap,
    use,
    get over() {
      return over;
    },
    get score() {
      return score;
    },
    get batch() {
      return batch;
    },
    get taps() {
      return taps;
    },
  };
}

/** FNV-1a over the whole state: equal hashes mean identical games (pinned-vector tests, debugging). */
export function hashTuState(s: TuState): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v | 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  mix(s.batch);
  mix(s.score);
  mix(s.over ? 1 : 0);
  s.orders.forEach(mix);
  mix(s.props.peek);
  mix(s.props.bag);
  mix(s.props.swap);
  mix(s.bagSize);
  mix(s.bag.length);
  s.bag.forEach(mix);
  for (const t of s.tiles) {
    mix(t.id);
    mix(t.tier);
    mix(t.x * 2);
    mix(t.y * 2);
    mix(t.layer);
    mix(t.visible ? 1 : 0);
  }
  return h.toString(16).padStart(8, "0");
}
