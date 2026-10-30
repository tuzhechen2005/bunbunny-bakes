import { describe, expect, it } from "vitest";
import {
  BIG_BASE, CELL_POINTS, EMPTY, MAX_CHAIN_MULTIPLIER, ROLL_BASE,
  createM3Game, immediateM3Score, legalM3Moves, tierOf, type M3State,
} from "@/lib/m3";
import { findMatches, planSwap } from "@/lib/m3/board";
import { chooseM3Move, greedyM3, randomM3 } from "../support/m3Bot";

const tiers = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}` }));

it("reconstructs every board/order/score change from events, including gravity and shuffle", () => {
  let shuffles = 0, orderHits = 0, specials = 0;
  for (const seed of ["m3-tune87", "pinned", "events1", "events2"]) {
    for (const bot of [randomM3, greedyM3]) {
      const run = bot(seed, tiers);
      const game = createM3Game({ seed, tiers });
      const view = game.state();
      for (const move of run.moves) {
        const before = game.state();
        const events = game.swap(move.a, move.b)!;
        const preview = immediateM3Score(before, move.a, move.b)!;
        let firstWavePoints = 0;
        let chain = 0;
        let counts = Array<number>(6).fill(0);
        for (const e of events) {
          if (e.type === "swap") {
            [view.board[e.a.r][e.a.c], view.board[e.b.r][e.b.c]] = [view.board[e.b.r][e.b.c], view.board[e.a.r][e.a.c]];
            view.movesLeft--;
          } else if (e.type === "special" && e.action !== "fired") {
            view.board[e.cell.r][e.cell.c] = (e.kind === "big" ? BIG_BASE : ROLL_BASE) + e.tier;
            specials++;
          } else if (e.type === "match") {
            expect(e.chain).toBe(++chain);
            expect(new Set(e.cells.map((p) => p.r * 8 + p.c)).size).toBe(e.cells.length);
            expect(e.points).toBeGreaterThanOrEqual(e.cells.length * CELL_POINTS * Math.min(chain, MAX_CHAIN_MULTIPLIER));
            counts = Array<number>(6).fill(0);
            for (const p of e.cells) { counts[tierOf(view.board[p.r][p.c])]++; view.board[p.r][p.c] = EMPTY; }
            view.score += e.points;
            if (chain === 1) firstWavePoints += e.points;
          } else if (e.type === "order") {
            const previous = view.orders[e.index];
            if (e.action === "progress") {
              expect(e.order.have).toBe(Math.min(previous.need, previous.have + counts[previous.tier]));
              expect(e.order.tier).toBe(previous.tier);
            } else if (e.action === "complete") {
              expect(e.order.have).toBe(e.order.need);
              view.score += e.order.points;
              if (chain === 1) firstWavePoints += e.order.points;
              orderHits++;
            } else {
              expect(e.order.have).toBe(0);
            }
            view.orders[e.index] = { ...e.order };
          } else if (e.type === "fall") {
            for (const { from, to, code } of e.tiles) {
              expect(to.c).toBe(from.c); expect(to.r).toBeGreaterThan(from.r);
              expect(view.board[from.r][from.c]).toBe(code);
              expect(view.board[to.r][to.c]).toBe(EMPTY);
              view.board[from.r][from.c] = EMPTY; view.board[to.r][to.c] = code;
            }
          } else if (e.type === "refill") {
            for (const p of e.tiles) {
              expect(view.board[p.r][p.c]).toBe(EMPTY);
              expect(p.code >= 0 && p.code < 6).toBe(true);
              view.board[p.r][p.c] = p.code;
            }
          } else if (e.type === "shuffle") {
            expect(legalM3Moves({ ...view, over: false })).toEqual([]);
            expect(e.board.flat().sort()).toEqual(view.board.flat().sort());
            expect(findMatches(e.board)).toEqual([]);
            view.board = e.board.map((r) => [...r]);
            shuffles++;
          } else if (e.type === "over") {
            expect(view.movesLeft).toBe(0);
            expect(findMatches(view.board)).toEqual([]);
            view.over = true;
          }
        }
        expect(firstWavePoints).toBe(preview);
        view.specials = view.board.flatMap((row, r) => row.flatMap((v, c) => v >= ROLL_BASE ? [{ r, c, kind: v >= BIG_BASE ? "big" as const : "roll" as const, tier: tierOf(v) }] : []));
        expect(view).toEqual(game.state());
        // No returned event may alias a live object.
        view.orders[0].have = 999;
        expect(game.state().orders[0].have).not.toBe(999);
        view.orders[0] = game.state().orders[0];
      }
    }
  }
  expect(shuffles).toBeGreaterThan(0); expect(orderHits).toBeGreaterThan(0); expect(specials).toBeGreaterThan(0);
});

it("an adjacent nonmatch is rejected without consuming RNG or a move", () => {
  const game = createM3Game({ seed: "nonmatch", tiers });
  const twin = createM3Game({ seed: "nonmatch", tiers });
  const before = game.state();
  let rejected = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 7; c++) {
    const a = { r, c }, b = { r, c: c + 1 };
    if (!planSwap(before.board, a, b)) { expect(game.swap(a, b)).toBeNull(); rejected++; }
  }
  expect(rejected).toBeGreaterThan(0);
  expect(game.state()).toEqual(before);
  const m = legalM3Moves(before)[0];
  expect(game.swap(m.a, m.b)).toEqual(twin.swap(m.a, m.b));
});

describe("bots", () => {
  it("random selects any legal move, greedy maximizes visible immediate points", () => {
    const game = createM3Game({ seed: "bot-view", tiers });
    for (let i = 0; i < 30; i++) {
      const state = game.state();
      const before = JSON.stringify(state);
      const moves = legalM3Moves(state);
      expect(chooseM3Move(state, false, (n) => n - 1)).toEqual(moves.at(-1));
      const choice = chooseM3Move(state, true, () => 0);
      expect(immediateM3Score(state, choice.a, choice.b)).toBe(Math.max(...moves.map((m) => immediateM3Score(state, m.a, m.b)!)));
      expect(JSON.stringify(state)).toBe(before);
      game.swap(choice.a, choice.b);
    }
    expect(legalM3Moves(game.state())).toEqual([]);
  });

  it("preview ignores any hidden future and honors the over flag", () => {
    const state = createM3Game({ seed: "visible", tiers }).state();
    const m = legalM3Moves(state)[0];
    const copy: M3State = JSON.parse(JSON.stringify(state));
    expect(immediateM3Score(state, m.a, m.b)).toBe(immediateM3Score(copy, m.a, m.b));
    copy.over = true;
    expect(immediateM3Score(copy, m.a, m.b)).toBeNull();
  });
});
