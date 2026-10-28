// 兔了个兔 engine (D121-D122): a layered tile-matching game with a 6-slot paper bag and two
// customer orders. Pure TS, integer maths and the seeded Rng only (no Date.now, no Math.random),
// so the client and the server's replay agree exactly.

import { createRng, type Rng } from "../game/rng";
import { BAG_SIZE, dealBatch, overlaps } from "./deal";

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
}

export interface TuState {
  /** 1-based 炉. */
  batch: number;
  /** Tiles still on the board, in deal order (bottom layers first). */
  tiles: TuTile[];
  /** Tier per bag slot, at most BAG_SIZE, equal tiers kept next to each other. */
  bag: number[];
  /** Tier each customer wants (3 of it). */
  orders: [number, number];
  score: number;
  over: boolean;
}

export type TuEvent =
  /** A tile left the board into bag slot `slot` (later slots shift right by one). */
  | { type: "move"; tile: number; tier: number; slot: number }
  /** Three of `tier` at slots slot..slot+2 were packed (later slots shift left by three). `points` includes the order bonus. */
  | { type: "pack"; tier: number; slot: number; points: number; order: boolean }
  /** Order `index` now wants `tier`. */
  | { type: "order"; index: 0 | 1; tier: number }
  /** Batch `batch` was dealt after the previous one was cleared; `bonus` points for clearing it. */
  | { type: "batch"; batch: number; bonus: number }
  | { type: "over" };

export interface TuGame {
  state(): TuState;
  /** null = not a tile on the board, covered, or the game is over. */
  tap(tileId: number): TuEvent[] | null;
  readonly over: boolean;
  readonly score: number;
  readonly batch: number;
  /** Accepted taps so far. */
  readonly taps: number;
}

export const MIN_TIERS = 2;
export const MAX_TIERS = 8;
/** The engine ends the game after this many taps, so client and server agree on the final score. */
export const MAX_TAPS = 2000;
/** Plausibility for the server: two taps closer than this (ms) are not a human. */
export const MIN_TAP_GAP_MS = 120;

/** Points per pack, x batch. */
export const PACK_POINTS = 10;
/** Extra points when a pack fills an order, x batch. */
export const ORDER_POINTS = 30;
/** Points for clearing a batch, x that batch's number. */
export const BATCH_POINTS = 100;

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
  const boardTiers = () => [...new Set(board.map((t) => t.tier))].sort((a, b) => a - b);

  /** A new tier for order `i`: on the board and not the other order's when possible. */
  const pickOrder = (i: 0 | 1, other: number | null): number => {
    const on = boardTiers();
    const pool = on.filter((t) => t !== other);
    const from = pool.length > 0 ? pool : on.length > 0 ? on : Array.from({ length: n }, (_, k) => k);
    return from[orderRng.int(from.length)];
  };

  deal();
  orders[0] = pickOrder(0, null);
  orders[1] = pickOrder(1, orders[0]);

  const state = (): TuState => ({
    batch,
    tiles: board.map((t) => ({ id: t.id, tier: t.tier, x: t.x2 / 2, y: t.y2 / 2, layer: t.layer, free: isFree(t) })),
    bag: [...bag],
    orders: [orders[0], orders[1]],
    score,
    over,
  });

  const tap = (tileId: number): TuEvent[] | null => {
    if (over) return null;
    const idx = board.findIndex((t) => t.id === tileId);
    if (idx < 0 || !isFree(board[idx])) return null;
    const tile = board[idx];
    board.splice(idx, 1);
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
        orders[i] = pickOrder(i, orders[1 - i]);
        events.push({ type: "order", index: i, tier: orders[i] });
      }
      if (dealt) {
        // Orders whose bread is not in the new batch get a new one.
        for (const i of [0, 1] as const) {
          if (!board.some((t) => t.tier === orders[i])) {
            orders[i] = pickOrder(i, orders[1 - i]);
            events.push({ type: "order", index: i, tier: orders[i] });
          }
        }
        events.push({ type: "batch", ...dealt });
      }
    } else if (bag.length >= BAG_SIZE) {
      over = true;
    }
    if (!over && taps >= MAX_TAPS) over = true;
    if (over) events.push({ type: "over" });
    return events;
  };

  return {
    state,
    tap,
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
  mix(s.bag.length);
  s.bag.forEach(mix);
  for (const t of s.tiles) {
    mix(t.id);
    mix(t.tier);
    mix(t.x * 2);
    mix(t.y * 2);
    mix(t.layer);
  }
  return h.toString(16).padStart(8, "0");
}
