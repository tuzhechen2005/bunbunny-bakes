// Pure board rules shared by live resolution and visible-board move evaluation.
import type { Rng } from "../game/rng";
import {
  BIG_BASE, BIG_POINTS, BOARD_SIZE, CELL_POINTS, EMPTY, MAX_TIERS, REFILL_BIAS_PERCENT, ROLL_BASE, ROLL_POINTS,
  type M3Cell, type M3Placement, type M3Swap,
} from "./types";

export const copyBoard = (board: readonly number[][]): number[][] => board.map((row) => [...row]);
export const tierOf = (code: number): number => code < 0 ? -1 : code % MAX_TIERS;
export const kindOf = (code: number): "roll" | "big" => code >= BIG_BASE ? "big" : "roll";
const key = (p: M3Cell) => p.r * BOARD_SIZE + p.c;
const cell = (i: number): M3Cell => ({ r: Math.floor(i / BOARD_SIZE), c: i % BOARD_SIZE });
const matchTier = (code: number) => code >= BIG_BASE ? -1 : tierOf(code);

/** Bias only toward triples containing this hole, using the just-resolved wave's tier counts.
 * Scan all six pairs after gravity. Deduplicate tiers, prefer the strongest local context,
 * then break ties with the board RNG. One integer chance draw per new tile, even with no pair.
 */
export function refillTier(board: readonly number[][], p: M3Cell, n: number, rng: Rng, counts: readonly number[]): number {
  if (rng.int(100) < REFILL_BIAS_PERCENT) {
    const candidates = new Set<number>();
    for (const [dr, dc] of [[0, 1], [1, 0]]) for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
      const first = { r: p.r + dr * a, c: p.c + dc * a };
      const second = { r: p.r + dr * b, c: p.c + dc * b };
      if (!validCell(first) || !validCell(second)) continue;
      const tier = matchTier(board[first.r][first.c]);
      if (tier < 0 || tier >= n || matchTier(board[second.r][second.c]) !== tier) continue;
      candidates.add(tier);
    }
    if (candidates.size) {
      const best = Math.max(...[...candidates].map((tier) => counts[tier] ?? 0));
      const pool = [...candidates].filter((tier) => (counts[tier] ?? 0) === best).sort((a, b) => a - b);
      return pool[rng.int(pool.length)];
    }
  }
  return rng.int(n);
}
export function validCell(p: unknown): p is M3Cell {
  if (!p || typeof p !== "object") return false;
  const { r, c } = p as M3Cell;
  return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}
export function exchange(board: number[][], a: M3Cell, b: M3Cell): void {
  [board[a.r][a.c], board[b.r][b.c]] = [board[b.r][b.c], board[a.r][a.c]];
}

interface Match { cells: M3Cell[]; longest: number; tier: number }
/** Maximal row/column runs, unioned only where they intersect; L/T uses longest line. */
export function findMatches(board: readonly number[][]): Match[] {
  const groups: Match[] = [];
  for (const vertical of [false, true]) for (let line = 0; line < BOARD_SIZE; line++) {
    let start = 0;
    while (start < BOARD_SIZE) {
      const at = (n: number): M3Cell => vertical ? { r: n, c: line } : { r: line, c: n };
      const p = at(start);
      const tier = matchTier(board[p.r][p.c]);
      let end = start + 1;
      while (end < BOARD_SIZE) {
        const q = at(end);
        if (tier < 0 || matchTier(board[q.r][q.c]) !== tier) break;
        end++;
      }
      if (tier >= 0 && end - start >= 3) {
        const ids = new Set(Array.from({ length: end - start }, (_, i) => key(at(start + i))));
        let longest = end - start;
        // One new run can join several earlier components.
        for (let i = groups.length - 1; i >= 0; i--) {
          if (groups[i].cells.some((c) => ids.has(key(c)))) {
            groups[i].cells.forEach((c) => ids.add(key(c)));
            longest = Math.max(longest, groups[i].longest);
            groups.splice(i, 1);
          }
        }
        groups.push({ cells: [...ids].sort((a, b) => a - b).map(cell), longest, tier });
      }
      start = end;
    }
  }
  return groups.sort((a, b) => key(a.cells[0]) - key(b.cells[0]));
}

export interface Wave {
  cells: M3Cell[];
  created: M3Placement[];
  converted: M3Placement[];
  fired: M3Placement[];
  /** Base points before the cascade multiplier; includes creation bonuses. */
  points: number;
}

/** Resolve one simultaneous clear; no RNG, gravity, refill, or order replacement. */
export function planWave(board: readonly number[][], swap?: M3Swap): Wave | null {
  const codes = board.flat();
  const clears = new Set<number>();
  const protectedCells = new Set<number>();
  const created: M3Placement[] = [], converted: M3Placement[] = [], fired: M3Placement[] = [];
  const firedIds = new Set<number>();
  const targets = new Map<number, number>();
  const add = (i: number) => { if (!protectedCells.has(i)) clears.add(i); };
  const addRow = (r: number) => { for (let c = 0; c < BOARD_SIZE; c++) add(r * BOARD_SIZE + c); };
  const addTier = (tier: number) => { codes.forEach((code, i) => { if (tierOf(code) === tier) add(i); }); };
  let combo = false;
  if (swap) {
    const ai = key(swap.a), bi = key(swap.b);
    const av = codes[ai], bv = codes[bi];
    if (av >= BIG_BASE || bv >= BIG_BASE) {
      combo = true;
      add(ai); add(bi);
      if (av >= BIG_BASE && bv >= BIG_BASE) {
        for (let i = 0; i < codes.length; i++) add(i);
        // The pair fires once as a board-clear, without additional tier effects.
        firedIds.add(ai); firedIds.add(bi);
        fired.push({ ...cell(ai), code: av }, { ...cell(bi), code: bv });
      } else {
        const big = av >= BIG_BASE ? ai : bi;
        const other = big === ai ? bv : av;
        const tier = tierOf(other);
        targets.set(big, tier);
        if (other >= ROLL_BASE) {
          codes.forEach((code, i) => {
            if (i !== big && tierOf(code) === tier && code !== ROLL_BASE + tier) {
              codes[i] = ROLL_BASE + tier;
              converted.push({ ...cell(i), code: codes[i] });
            }
          });
        }
        addTier(tier);
      }
    } else if (av >= ROLL_BASE && bv >= ROLL_BASE) {
      combo = true;
      addRow(swap.b.r);
      for (let r = 0; r < BOARD_SIZE; r++) add(r * BOARD_SIZE + swap.b.c);
      add(ai); add(bi);
      firedIds.add(ai); firedIds.add(bi);
      fired.push({ ...cell(ai), code: av }, { ...cell(bi), code: bv });
    }
  }
  if (!combo) {
    const groups = findMatches(board);
    if (!groups.length) return null;
    for (const group of groups) {
      if (group.longest >= 4) {
        const preferred = swap ? [swap.b, swap.a, ...group.cells] : group.cells;
        // Existing specials must fire, never be overwritten by a newly created special.
        const anchor = preferred.find((p) => group.cells.some((q) => key(p) === key(q)) && board[p.r][p.c] < ROLL_BASE);
        if (anchor) {
          protectedCells.add(key(anchor));
          created.push({ ...anchor, code: (group.longest >= 5 ? BIG_BASE : ROLL_BASE) + group.tier });
        }
      }
    }
    for (const group of groups) for (const p of group.cells) add(key(p));
  }
  // Set insertion order is deterministic. Newly reached specials extend the same wave.
  for (const i of clears) {
    const code = codes[i];
    if (code < ROLL_BASE || firedIds.has(i)) continue;
    firedIds.add(i);
    fired.push({ ...cell(i), code });
    if (code >= BIG_BASE) addTier(targets.get(i) ?? tierOf(code));
    else addRow(cell(i).r);
  }
  const cells = [...clears].sort((a, b) => a - b).map(cell);
  return {
    cells, created, converted, fired,
    points: cells.length * CELL_POINTS + created.reduce((sum, s) => sum + (s.code >= BIG_BASE ? BIG_POINTS : ROLL_POINTS), 0),
  };
}

export function planSwap(board: readonly number[][], a: M3Cell, b: M3Cell): { board: number[][]; wave: Wave } | null {
  if (!validCell(a) || !validCell(b) || Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) return null;
  const next = copyBoard(board);
  exchange(next, a, b);
  const wave = planWave(next, { a, b });
  return wave ? { board: next, wave } : null;
}

/** Fast legal-move check on a settled board (no pre-existing matches). */
function legal(board: number[][], a: M3Cell, b: M3Cell): boolean {
  const x = board[a.r][a.c], y = board[b.r][b.c];
  if (x >= BIG_BASE || y >= BIG_BASE || (x >= ROLL_BASE && y >= ROLL_BASE)) return true;
  if (matchTier(x) === matchTier(y)) return false;
  exchange(board, a, b);
  const inLine = (p: M3Cell) => {
    const t = matchTier(board[p.r][p.c]);
    for (const [dr, dc] of [[1, 0], [0, 1]]) {
      let n = 1;
      for (const sign of [-1, 1]) {
        let r = p.r + sign * dr, c = p.c + sign * dc;
        while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && matchTier(board[r][c]) === t) {
          n++; r += sign * dr; c += sign * dc;
        }
      }
      if (n >= 3) return true;
    }
    return false;
  };
  const yes = inLine(a) || inLine(b);
  exchange(board, a, b);
  return yes;
}
export function legalSwaps(board: readonly number[][], firstOnly = false): M3Swap[] {
  const work = copyBoard(board), out: M3Swap[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) {
    const a = { r, c };
    for (const b of [{ r, c: c + 1 }, { r: r + 1, c }]) {
      if (validCell(b) && legal(work, a, b)) {
        out.push({ a: { ...a }, b });
        if (firstOnly) return out;
      }
    }
  }
  return out;
}

/** Generate without triples; rejecting dead boards consumes only the board RNG stream. */
export function initialBoard(n: number, rng: Rng): number[][] {
  for (let attempt = 0; attempt < 128; attempt++) {
    const board = Array.from({ length: BOARD_SIZE }, () => Array<number>(BOARD_SIZE).fill(EMPTY));
    for (let r = 0; r < BOARD_SIZE; r++) for (let c = 0; c < BOARD_SIZE; c++) {
      const pool = Array.from({ length: n }, (_, i) => i).filter((t) =>
        !(c >= 2 && board[r][c - 1] === t && board[r][c - 2] === t) &&
        !(r >= 2 && board[r - 1][c] === t && board[r - 2][c] === t));
      board[r][c] = pool[rng.int(pool.length)];
    }
    if (legalSwaps(board, true).length) return board;
  }
  // A deterministic, match-free fallback with a guaranteed swap at (0,1) <-> (1,1).
  // This also bounds board generation for degenerate RNG streams.
  const board = Array.from({ length: BOARD_SIZE }, (_, r) => Array.from({ length: BOARD_SIZE }, (_, c) => (r + c) % n));
  board[0][2] = 0;
  board[1][1] = 0;
  return board;
}

/** Preserve every tile if possible; bounded retries then a fresh board, with no credit/cost. */
export function reshuffle(board: readonly number[][], rng: Rng, n = MAX_TIERS): number[][] {
  const codes = board.flat();
  for (let attempt = 0; attempt < 128; attempt++) {
    for (let i = codes.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [codes[i], codes[j]] = [codes[j], codes[i]];
    }
    const next = Array.from({ length: BOARD_SIZE }, (_, r) => codes.slice(r * BOARD_SIZE, (r + 1) * BOARD_SIZE));
    if (!findMatches(next).length && legalSwaps(next, true).length) return next;
  }
  return initialBoard(n, rng);
}
