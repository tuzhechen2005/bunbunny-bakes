import { expect, it } from "vitest";
import { findMatches, initialBoard, legalSwaps, refillTier, reshuffle } from "@/lib/m3/board";
import { BIG_BASE, EMPTY, REFILL_BIAS_PERCENT, ROLL_BASE } from "@/lib/m3";
import type { Rng } from "@/lib/game/rng";

const empty = () => Array.from({ length: 8 }, () => Array<number>(8).fill(EMPTY));
const draws = (...values: number[]): Rng => ({
  next: () => { throw new Error("refill must use integer RNG"); },
  int: (n) => {
    const value = values.shift();
    if (value === undefined || value < 0 || value >= n) throw new Error(`bad draw ${value}/${n}`);
    return value;
  },
});

it("biased refill completes triples in all six orientations, including pins", () => {
  for (const [dr, dc] of [[0, 1], [1, 0]]) for (const offsets of [[-2, -1], [-1, 1], [1, 2]]) {
    const board = empty();
    offsets.forEach((offset, i) => { board[3 + dr * offset][3 + dc * offset] = i ? ROLL_BASE + 2 : 2; });
    expect(refillTier(board, { r: 3, c: 3 }, 6, draws(0, 0), [])).toBe(2);
    expect(board[3][3]).toBe(EMPTY);
  }
});

it("prefers the resolution's most-cleared tier, breaking equal context ties by seeded draw", () => {
  const board = empty();
  board[3][1] = board[3][2] = 1;
  board[1][3] = board[2][3] = 2;
  expect(refillTier(board, { r: 3, c: 3 }, 6, draws(0, 0), [0, 3, 5])).toBe(2);
  expect(refillTier(board, { r: 3, c: 3 }, 6, draws(0, 0), [0, 3, 3])).toBe(1);
  expect(refillTier(board, { r: 3, c: 3 }, 6, draws(0, 1), [0, 3, 3])).toBe(2);
});

it("uses uniform tiers on a missed bias roll or with no candidate; big breads never match", () => {
  const board = empty();
  board[0][1] = board[0][2] = 2;
  expect(refillTier(board, { r: 0, c: 0 }, 6, draws(REFILL_BIAS_PERCENT, 5), [])).toBe(5);
  board[0][1] = BIG_BASE + 2;
  expect(refillTier(board, { r: 0, c: 0 }, 6, draws(0, 4), [])).toBe(4);
  expect(refillTier(empty(), { r: 7, c: 7 }, 4, draws(0, 3), [])).toBe(3);
});

it.each([4, 5, 6])("bounds generation and reshuffle even with an adversarial RNG (%i tiers)", (n) => {
  let calls = 0;
  const rng: Rng = { next: () => { throw new Error("integer draws only"); }, int: () => {
    if (++calls > 20_000) throw new Error("unbounded generation");
    return 0;
  } };
  const initial = initialBoard(n, rng);
  expect(findMatches(initial)).toEqual([]);
  expect(legalSwaps(initial).length).toBeGreaterThan(0);
  calls = 0;
  const impossible = Array.from({ length: 8 }, () => Array<number>(8).fill(0));
  const settled = reshuffle(impossible, rng, n);
  expect(findMatches(settled)).toEqual([]);
  expect(legalSwaps(settled).length).toBeGreaterThan(0);
  expect(settled.flat().every((code) => code >= 0 && code < n)).toBe(true);
});

it.each([4, 5, 6])("has a legal fallback after repeatedly generating a dead board (%i tiers)", (n) => {
  let calls = 0;
  const rng: Rng = { next: () => { throw new Error("integer draws only"); }, int: () => {
    const i = calls++ % 64;
    if (calls > 8192) throw new Error("unbounded dead-board retry");
    return (Math.floor(i / 8) + i % 8) % n;
  } };
  const board = initialBoard(n, rng);
  expect(calls).toBe(8192);
  expect(findMatches(board)).toEqual([]);
  expect(legalSwaps(board)).toContainEqual({ a: { r: 0, c: 1 }, b: { r: 1, c: 1 } });
});
