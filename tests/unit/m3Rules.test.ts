import { describe, expect, it } from "vitest";
import { createRng } from "@/lib/game/rng";
import { BIG_BASE, ROLL_BASE, CELL_POINTS, ROLL_POINTS, BIG_POINTS } from "@/lib/m3";
import { findMatches, planWave, planSwap, reshuffle, legalSwaps } from "@/lib/m3/board";

// No accidental triples; individual fixtures change just the cells under test.
const board = () => Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => (r + c) % 6));
const row = (r: number) => Array.from({ length: 8 }, (_, c) => ({ r, c }));

describe("match waves", () => {
  it.each([3, 4, 5, 6, 7, 8])("a horizontal line of %i uses its longest length", (length) => {
    const b = board();
    for (let c = 0; c < length; c++) b[3][c] = 0;
    if (length < 8) b[3][length] = 1;
    const w = planWave(b)!;
    expect(w.created).toHaveLength(length >= 4 ? 1 : 0);
    expect(w.cells).toHaveLength(length - (length >= 4 ? 1 : 0));
    if (length >= 4) expect(w.created[0]).toEqual({ r: 3, c: 0, code: (length >= 5 ? BIG_BASE : ROLL_BASE) });
    expect(w.points).toBe(w.cells.length * CELL_POINTS + (length >= 5 ? BIG_POINTS : length === 4 ? ROLL_POINTS : 0));
  });

  it("vertical four creates a row-clearing roll too", () => {
    const b = board();
    for (let r = 1; r <= 4; r++) b[r][3] = 0;
    expect(planWave(b)!.created).toEqual([{ r: 1, c: 3, code: ROLL_BASE }]);
  });

  it.each([3, 4, 5])("an intersecting L/T uses longest line %i, not union size", (length) => {
    const b = board();
    for (let c = 1; c <= length; c++) b[3][c] = 0;
    for (let r = 2; r <= 4; r++) b[r][2] = 0;
    const w = planWave(b)!;
    expect(w.created).toHaveLength(length === 3 ? 0 : 1);
    expect(w.cells).toHaveLength(length + 2 - w.created.length);
    if (length > 3) expect(w.created[0].code).toBe(length === 4 ? ROLL_BASE : BIG_BASE);
  });

  it("separate lines create separate specials; a swap prefers destination then source", () => {
    const b = board();
    b[1] = [0, 0, 1, 0, 2, 3, 4, 5];
    b[2][2] = 0;
    expect(planSwap(b, { r: 2, c: 2 }, { r: 1, c: 2 })!.wave.created).toEqual([{ r: 1, c: 2, code: ROLL_BASE }]);
    b[1][2] = 0;
    b[6] = [1, 1, 1, 1, 2, 3, 4, 5];
    expect(planWave(b)!.created).toHaveLength(2);
  });

  it("matching a roll clears its entire row, chains to another special, and counts cells once", () => {
    const b = board();
    b[3] = [0, ROLL_BASE, 0, 3, 4, ROLL_BASE + 5, 1, 2];
    const w = planWave(b)!;
    expect(w.cells).toEqual(row(3));
    expect(w.fired).toHaveLength(2);
    expect(w.points).toBe(8 * CELL_POINTS);
  });

  it("a big hit by an effect clears its retained tier; big is not a wildcard in lines", () => {
    const b = board();
    b[3] = [0, ROLL_BASE, 0, 3, 4, BIG_BASE + 5, 1, 2];
    const w = planWave(b)!;
    expect(w.fired.map((s) => s.code)).toEqual([ROLL_BASE, BIG_BASE + 5]);
    expect(w.cells).toEqual(expect.arrayContaining([{ r: 0, c: 5 }, { r: 1, c: 4 }]));
    b[3] = [0, BIG_BASE, 0, 3, 4, 5, 1, 2];
    expect(findMatches(b)).toEqual([]);
  });
});

describe("special swaps", () => {
  const a = { r: 3, c: 3 }, z = { r: 3, c: 4 };
  it.each([false, true])("big + normal clears the swapped tier (reversed=%s)", (reverse) => {
    const b = board(); b[3][3] = BIG_BASE + 2; b[3][4] = 1;
    const p = planSwap(b, reverse ? z : a, reverse ? a : z)!;
    expect(p.wave.cells).toContainEqual(z);
    expect(p.wave.cells).toContainEqual(a);
    expect(p.wave.cells).toContainEqual({ r: 0, c: 1 });
    expect(p.wave.cells).not.toContainEqual({ r: 0, c: 2 });
  });

  it("roll + roll clears destination row and column", () => {
    const b = board(); b[3][3] = ROLL_BASE; b[3][4] = ROLL_BASE + 1;
    const w = planSwap(b, a, z)!.wave;
    expect(w.cells).toHaveLength(15);
    expect(w.cells).toEqual(expect.arrayContaining(row(3)));
    for (let r = 0; r < 8; r++) expect(w.cells).toContainEqual({ r, c: 4 });
    expect(w.fired).toHaveLength(2);
  });

  it.each([false, true])("big + roll converts that tier and fires every converted roll (reversed=%s)", (reverse) => {
    const b = board(); b[3][3] = BIG_BASE + 2; b[3][4] = ROLL_BASE + 1;
    const w = planSwap(b, reverse ? z : a, reverse ? a : z)!.wave;
    const targets = b.flat().filter((v) => v % 6 === 1).length;
    expect(w.converted).toHaveLength(targets - 1);
    expect(w.fired.filter((s) => s.code === ROLL_BASE + 1)).toHaveLength(targets);
    expect(w.cells).toHaveLength(64);
  });

  it("big + big clears all 64 cells", () => {
    const b = board(); b[3][3] = BIG_BASE; b[3][4] = BIG_BASE + 1;
    const w = planSwap(b, a, z)!.wave;
    expect(w.cells).toHaveLength(64);
    expect(w.points).toBe(64 * CELL_POINTS);
    expect(w.fired).toHaveLength(2);
  });

  it("a roll cannot fire from a plain nonmatching swap", () => {
    const b = board(); b[3][3] = ROLL_BASE;
    expect(planSwap(b, a, z)).toBeNull();
  });
});

it("reshuffles a dead board deterministically, retaining the exact tile multiset", () => {
  const b = board();
  expect(findMatches(b)).toEqual([]);
  expect(legalSwaps(b)).toEqual([]);
  const x = reshuffle(b, createRng("shuffle"));
  expect(x).toEqual(reshuffle(b, createRng("shuffle")));
  expect(x.flat().sort()).toEqual(b.flat().sort());
  expect(findMatches(x)).toEqual([]);
  expect(legalSwaps(x).length).toBeGreaterThan(0);
  expect(b).toEqual(board());
});

it("an L with two threes creates no special; an L with a four creates one roll", () => {
  for (const length of [3, 4]) {
    const b = board();
    for (let c = 1; c <= length; c++) b[1][c] = 0;
    b[1][length + 1] = 2;
    for (let r = 1; r <= 3; r++) b[r][1] = 0;
    const w = planWave(b)!;
    expect(w.created).toHaveLength(length === 4 ? 1 : 0);
    expect(w.cells).toHaveLength(length + 2 - w.created.length);
  }
});

it("a new special survives the creating wave, while an old roll in its line fires", () => {
  const b = board();
  b[3] = [0, 0, ROLL_BASE, 0, 2, 3, 4, 5];
  const w = planWave(b)!;
  expect(w.created).toEqual([{ r: 3, c: 0, code: ROLL_BASE }]);
  expect(w.fired).toEqual([{ r: 3, c: 2, code: ROLL_BASE }]);
  expect(w.cells).toEqual(row(3).slice(1));
});

it("big + roll converts another big of the target tier, too", () => {
  const b = board();
  b[3][3] = BIG_BASE + 2; b[3][4] = ROLL_BASE + 1; b[0][1] = BIG_BASE + 1;
  const w = planSwap(b, { r: 3, c: 3 }, { r: 3, c: 4 })!.wave;
  expect(w.converted).toContainEqual({ r: 0, c: 1, code: ROLL_BASE + 1 });
  expect(w.fired).toContainEqual({ r: 0, c: 1, code: ROLL_BASE + 1 });
});

it("shuffle retains special codes as well as ordinary tiles", () => {
  const b = board(); b[1][1] = ROLL_BASE + 2; b[5][5] = BIG_BASE + 4;
  const shuffled = reshuffle(b, createRng("special-shuffle"));
  expect(shuffled.flat().sort()).toEqual(b.flat().sort());
  expect(findMatches(shuffled)).toEqual([]);
  expect(legalSwaps(shuffled).length).toBeGreaterThan(0);
});
