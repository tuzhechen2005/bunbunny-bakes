import { expect, it } from "vitest";
import { createM3Game, m3Level, m3LevelWitness, replayM3, legalM3Moves } from "@/lib/m3";
import { greedyM3 } from "../support/m3Bot";

it("deals identical weekly levels, with increasing targets and decreasing moves", () => {
  let previous = m3Level("2026-10-26", 1);
  for (let n = 1; n <= 30; n++) {
    const level = m3Level("2026-10-26", n);
    expect(m3Level("2026-10-26", n)).toEqual(level);
    expect(level.target).toBeGreaterThanOrEqual(previous.target);
    expect(level.moves).toBeLessThanOrEqual(previous.moves);
    expect(level.tierCount).toBeGreaterThanOrEqual(previous.tierCount);
    const tiers = Array.from({ length: level.tierCount }, (_, i) => ({ id: String(i) }));
    const proof = m3LevelWitness(level)!;
    expect(replayM3(level.seed, tiers, proof, level).score).toBeGreaterThanOrEqual(level.target);
    previous = level;
  }
  expect(previous.tierCount).toBe(6);
  expect(m3Level("2026-11-02", 1).seed).not.toBe(m3Level("2026-10-26", 1).seed);
  for (const n of [0, -1, 1.5, NaN]) expect(() => m3Level("2026-10-26", n)).toThrow();
}, 60_000);

it("wins early, fails at the limit, and rejects moves after either ending", () => {
  const tiers = Array.from({ length: 4 }, (_, i) => ({ id: `t${i}` }));
  for (const target of [1, 1_000_000]) {
    const rules = { moves: target === 1 ? 4 : 1, target };
    const game = createM3Game({ seed: "level-test", tiers, ...rules });
    const move = { ...legalM3Moves(game.state())[0], at: 0 };
    game.swap(move.a, move.b);
    expect(game.over).toBe(true);
    expect(game.state().movesLeft).toBe(target === 1 ? 3 : 0);
    expect(game.swap(move.a, move.b)).toBeNull();
    expect(replayM3("level-test", tiers, [move], rules).over).toBe(true);
    expect(() => replayM3("level-test", tiers, [move, { ...move, at: 500 }], rules)).toThrow();
  }
  const level = m3Level("2026-10-26", 1);
  const bot = greedyM3(level.seed, tiers, level);
  expect(replayM3(level.seed, tiers, bot.moves, level).score).toBe(bot.score);
});


it("forks board, score, orders and RNG independently without changing replay", () => {
  const rules = { seed: "branch-proof", moves: 9, target: 9000 };
  const tiers = Array.from({ length: 6 }, (_, i) => ({ id: String(i) }));
  const game = createM3Game({ ...rules, tiers });
  const moves: import("@/lib/m3").M3Move[] = [];
  while (!game.over) {
    const before = game.state();
    const candidates = legalM3Moves(before);
    for (const move of candidates) {
      const branch = game.fork();
      branch.swap(move.a, move.b);
      expect(game.state()).toEqual(before);
      expect(branch.score).toBe(replayM3(rules.seed, tiers, [...moves, { ...move, at: moves.length * 500 }], rules).score);
    }
    const move = { ...candidates[0], at: moves.length * 500 };
    const branch = game.fork();
    expect(branch.swap(move.a, move.b)).toEqual(game.swap(move.a, move.b));
    expect(branch.state()).toEqual(game.state());
    moves.push(move);
  }
});
