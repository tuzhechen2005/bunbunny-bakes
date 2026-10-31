import { createRng } from "../game/rng";
import { copyBoard, initialBoard, kindOf, legalSwaps, planSwap, planWave, refillTier, reshuffle, tierOf, type Wave } from "./board";
import {
  BOARD_SIZE, EMPTY, MAX_CASCADE_STEPS, MAX_CHAIN_MULTIPLIER, MAX_MOVES, MAX_TIERS, MIN_TIERS,
  ORDER_MAX_NEED, ORDER_MIN_NEED, ORDER_POINTS_PER_TILE, ROLL_BASE,
  type M3Cell, type M3Event, type M3Game, type M3Order, type M3Special, type M3State, type M3Swap, type M3TierInput,
} from "./types";

export function legalM3Moves(state: M3State): M3Swap[] {
  return state.over ? [] : legalSwaps(state.board);
}

/** Immediate visible-board score only: no future RNG, gravity matches, or new orders. */
export function immediateM3Score(state: M3State, a: M3Cell, b: M3Cell): number | null {
  if (state.over) return null;
  const plan = planSwap(state.board, a, b);
  if (!plan) return null;
  return plan.wave.points + state.orders.reduce((points, order) => {
    const count = plan.wave.cells.filter((p) => tierOf(plan.board[p.r][p.c]) === order.tier).length;
    return points + (order.have + count >= order.need ? order.points : 0);
  }, 0);
}

export function createM3Game(opts: { seed: string; tiers: readonly M3TierInput[] }): M3Game {
  if (opts.tiers.length < MIN_TIERS) throw new RangeError(`m3: needs at least ${MIN_TIERS} bread tiers`);
  const n = Math.min(MAX_TIERS, opts.tiers.length);
  const rng = createRng(`${opts.seed}:m3:board`);
  const orderRng = createRng(`${opts.seed}:m3:orders`);
  let board = initialBoard(n, rng);
  let moves = 0, score = 0;
  const newOrder = (other: number): M3Order => {
    const pool = Array.from({ length: n }, (_, i) => i).filter((t) => t !== other);
    const tier = pool[orderRng.int(pool.length)];
    const need = ORDER_MIN_NEED + orderRng.int(ORDER_MAX_NEED - ORDER_MIN_NEED + 1);
    return { tier, need, have: 0, points: need * ORDER_POINTS_PER_TILE };
  };
  const first = newOrder(-1);
  const orders: [M3Order, M3Order] = [first, newOrder(first.tier)];

  const state = (): M3State => {
    const specials: M3Special[] = [];
    board.forEach((row, r) => row.forEach((code, c) => {
      if (code >= ROLL_BASE) specials.push({ r, c, kind: kindOf(code), tier: tierOf(code) });
    }));
    return { board: copyBoard(board), specials, orders: [{ ...orders[0] }, { ...orders[1] }], score, movesLeft: MAX_MOVES - moves, over: moves === MAX_MOVES };
  };

  function resolve(wave: Wave, chain: number, events: M3Event[]): void {
    // Count from the pre-clear board; retained creation anchors are not cleared or ordered.
    const counts = Array<number>(n).fill(0);
    for (const p of wave.cells) counts[tierOf(board[p.r][p.c])]++;
    for (const [action, list] of [["converted", wave.converted], ["fired", wave.fired]] as const) {
      for (const p of list) events.push({ type: "special", action, cell: { r: p.r, c: p.c }, kind: kindOf(p.code), tier: tierOf(p.code), chain });
    }
    const points = wave.points * Math.min(chain, MAX_CHAIN_MULTIPLIER);
    score += points;
    events.push({ type: "match", cells: wave.cells, points, chain });
    for (const p of wave.cells) board[p.r][p.c] = EMPTY;
    for (const p of wave.created) {
      board[p.r][p.c] = p.code;
      events.push({ type: "special", action: "created", cell: { r: p.r, c: p.c }, kind: kindOf(p.code), tier: tierOf(p.code), chain });
    }
    // Complete both old orders before replacing either. A clear never counts twice for a
    // replacement drawn in this wave; that order starts receiving credit next cascade.
    const completed: (0 | 1)[] = [];
    for (const i of [0, 1] as const) {
      const order = orders[i];
      if (!counts[order.tier]) continue;
      order.have = Math.min(order.need, order.have + counts[order.tier]);
      events.push({ type: "order", action: "progress", index: i, order: { ...order } });
      if (order.have === order.need) {
        score += order.points;
        events.push({ type: "order", action: "complete", index: i, order: { ...order } });
        completed.push(i);
      }
    }
    for (const i of completed) {
      orders[i] = newOrder(orders[1 - i].tier);
      events.push({ type: "order", action: "new", index: i, order: { ...orders[i] } });
    }

    const falling: Extract<M3Event, { type: "fall" }>["tiles"] = [];
    const refills: Extract<M3Event, { type: "refill" }>["tiles"] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      let dest = BOARD_SIZE - 1;
      for (let r = BOARD_SIZE - 1; r >= 0; r--) {
        const code = board[r][c];
        if (code === EMPTY) continue;
        if (dest !== r) {
          board[dest][c] = code; board[r][c] = EMPTY;
          falling.push({ from: { r, c }, to: { r: dest, c }, code });
        }
        dest--;
      }
    }
    // Finish all gravity first so candidates never rely on neighbours about to fall.
    // Column order left-to-right, refill bottom-to-top: part of the v2 replay contract.
    for (let c = 0; c < BOARD_SIZE; c++) {
      for (let r = BOARD_SIZE - 1; r >= 0; r--) {
        if (board[r][c] !== EMPTY) continue;
        const code = refillTier(board, { r, c }, n, rng, counts);
        board[r][c] = code;
        refills.push({ r, c, code });
      }
    }
    if (falling.length) events.push({ type: "fall", tiles: falling });
    if (refills.length) events.push({ type: "refill", tiles: refills });
  }

  function swap(a: M3Cell, b: M3Cell): M3Event[] | null {
    if (moves === MAX_MOVES) return null;
    const plan = planSwap(board, a, b);
    if (!plan) return null;
    board = plan.board;
    moves++;
    const events: M3Event[] = [{ type: "swap", a: { ...a }, b: { ...b } }];
    let wave: Wave | null = plan.wave;
    let chain = 1;
    while (wave && chain <= MAX_CASCADE_STEPS) {
      resolve(wave, chain++, events);
      wave = planWave(board);
    }
    if (wave) {
      // Stop a pathological chain without extra score/order credit. A fresh settled board
      // avoids asking multiset-preserving shuffle to solve an impossible tier distribution.
      board = initialBoard(n, rng);
      events.push({ type: "shuffle", board: copyBoard(board) });
    } else if (!legalSwaps(board, true).length) {
      board = reshuffle(board, rng, n);
      events.push({ type: "shuffle", board: copyBoard(board) });
    }
    if (moves === MAX_MOVES) events.push({ type: "over" });
    return events;
  }
  return { state, swap, get score() { return score; }, get over() { return moves === MAX_MOVES; }, get moves() { return moves; } };
}

/** FNV-1a debugging fingerprint of the entire public state (not a security hash). */
export function hashM3State(state: M3State): string {
  let h = 0x811c9dc5;
  const data = JSON.stringify(state);
  for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}
