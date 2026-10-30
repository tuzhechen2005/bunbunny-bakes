import { describe, expect, it } from "vitest";
import { createM3Game, hashM3State, replayM3, M3ReplayError, MAX_MOVES, MIN_MOVE_GAP_MS, M3_ENGINE_VERSION, legalM3Moves, type M3Move } from "@/lib/m3";
import { findMatches } from "@/lib/m3/board";
import { randomM3, greedyM3 } from "../support/m3Bot";

const tiers = (n = 6) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));

describe("M3 engine", () => {
  it("uses the first six tiers, requires four, and exposes version/limits", () => {
    for (let n = 0; n < 4; n++) expect(() => createM3Game({ seed: "x", tiers: tiers(n) })).toThrow(RangeError);
    expect(createM3Game({ seed: "x", tiers: tiers(8) }).state()).toEqual(createM3Game({ seed: "x", tiers: tiers() }).state());
    expect([MAX_MOVES, MIN_MOVE_GAP_MS, M3_ENGINE_VERSION]).toEqual([30, 150, 1]);
  });

  it.each([4, 5, 6])("starts with no matches and a legal move over 200 seeds (%i tiers)", (n) => {
    for (let i = 0; i < 200; i++) {
      const s = createM3Game({ seed: `initial${i}`, tiers: tiers(n) }).state();
      expect(s.board).toHaveLength(8);
      expect(s.board.every((r) => r.length === 8 && r.every((v) => v >= 0 && v < n))).toBe(true);
      expect(findMatches(s.board)).toEqual([]);
      expect(legalM3Moves(s).length).toBeGreaterThan(0);
      expect(s).toMatchObject({ movesLeft: 30, score: 0, specials: [], over: false });
      expect(s.orders).toHaveLength(2);
      expect(s.orders[0].tier).not.toBe(s.orders[1].tier);
    }
  });

  it("invalid swaps change neither state nor subsequent RNG; snapshots are detached", () => {
    const g = createM3Game({ seed: "copy", tiers: tiers() });
    const twin = createM3Game({ seed: "copy", tiers: tiers() });
    const before = g.state();
    for (const a of [null, {}, { r: -1, c: 0 }, { r: 8, c: 0 }, { r: 0.5, c: 0 }, { r: NaN, c: 0 }]) {
      expect(g.swap(a as never, { r: 0, c: 0 })).toBeNull();
    }
    expect(g.swap({ r: 0, c: 0 }, { r: 1, c: 1 })).toBeNull();
    expect(g.swap({ r: 0, c: 0 }, { r: 0, c: 0 })).toBeNull();
    expect(g.state()).toEqual(before);
    const move = legalM3Moves(before)[0];
    before.board[0][0] = 999; before.orders[0].have = 999; before.specials.push({ r: 0, c: 0, kind: "big", tier: 0 });
    expect(g.swap(move.a, move.b)).toEqual(twin.swap(move.a, move.b));
    expect(g.state()).toEqual(twin.state());
  });

  it.each([4, 5, 6])("determinism, replay, score accounting, settled boards and orders (%i tiers)", (n) => {
    let completed = 0, cascades = 0, created = 0;
    for (let i = 0; i < 20; i++) for (const bot of [randomM3, greedyM3]) {
      const seed = `live${i}`;
      const run = bot(seed, tiers(n));
      const g = createM3Game({ seed, tiers: tiers(n) });
      const twin = createM3Game({ seed, tiers: tiers(n) });
      let sum = 0;
      for (const [index, m] of run.moves.entries()) {
        const events = g.swap(m.a, m.b)!;
        expect(events).toEqual(twin.swap(m.a, m.b));
        expect(events[0].type).toBe("swap");
        for (const e of events) {
          if (e.type === "match") { sum += e.points; if (e.chain > 1) cascades++; }
          if (e.type === "special" && e.action === "created") created++;
          if (e.type === "order" && e.action === "complete") { sum += e.order.points; completed++; }
        }
        const s = g.state();
        expect(s.score).toBe(sum);
        expect(s.movesLeft).toBe(29 - index);
        expect(findMatches(s.board)).toEqual([]);
        expect(s.orders[0].tier).not.toBe(s.orders[1].tier);
        for (const o of s.orders) {
          expect(o.need).toBeGreaterThanOrEqual(10); expect(o.need).toBeLessThanOrEqual(15);
          expect(o.have).toBeLessThan(o.need); expect(o.have).toBeGreaterThanOrEqual(0);
        }
        if (!s.over) expect(legalM3Moves(s).length).toBeGreaterThan(0);
        if (index === 29) expect(events.at(-1)?.type).toBe("over");
      }
      expect(g.swap(run.moves[0].a, run.moves[0].b)).toBeNull();
      expect(g.state()).toMatchObject({ over: true, movesLeft: 0, score: run.score });
      expect(replayM3(seed, tiers(n), run.moves)).toEqual({ score: run.score, over: true, moves: 30 });
      expect(replayM3(seed, tiers(n), run.moves.slice(0, 5))).toMatchObject({ over: false, moves: 5 });
    }
    expect(completed).toBeGreaterThan(0); expect(cascades).toBeGreaterThan(0); expect(created).toBeGreaterThan(0);
  }, 30_000);

  it("pins an initial board and full greedy game", () => {
    const g = createM3Game({ seed: "pinned", tiers: tiers() });
    expect(hashM3State(g.state())).toMatchInlineSnapshot(`"1f7967a9"`);
    const run = greedyM3("pinned", tiers());
    for (const m of run.moves) g.swap(m.a, m.b);
    expect({ score: run.score, specials: run.specials, reshuffles: run.reshuffles, hash: hashM3State(g.state()) }).toMatchInlineSnapshot(`
      {
        "hash": "0f7746e1",
        "reshuffles": 0,
        "score": 8420,
        "specials": 12,
      }
    `);
  });
});

describe("replay validation", () => {
  const seed = "errors";
  const run = randomM3(seed, tiers());
  const m = run.moves[0];
  const bad = (moves: unknown, message: RegExp) => {
    expect(() => replayM3(seed, tiers(), moves as M3Move[])).toThrow(M3ReplayError);
    expect(() => replayM3(seed, tiers(), moves as M3Move[])).toThrow(message);
  };
  it("allows empty and unfinished runs", () => {
    expect(replayM3(seed, tiers(), [])).toEqual({ score: 0, over: false, moves: 0 });
    expect(() => replayM3(seed, tiers(3), [])).toThrow(RangeError);
  });
  it("rejects malformed moves, coordinates, timestamps, and illegal swaps", () => {
    bad(null, /array/); bad({}, /array/); bad([null], /bad move/); bad([1], /bad move/);
    for (const p of [undefined, null, {}, { r: 0, c: 8 }, { r: -1, c: 0 }, { r: 0.1, c: 0 }, { r: 0, c: "1" }, { r: Infinity, c: 0 }]) {
      bad([{ ...m, a: p }], /position/); bad([{ ...m, b: p }], /position/);
    }
    for (const at of [undefined, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0"]) bad([{ ...m, at }], /time/);
    bad([m, { ...run.moves[1], at: m.at }], /increasing/);
    bad([{ ...m, at: 500 }, { ...run.moves[1], at: 499 }], /increasing/);
    bad([m, { ...run.moves[1], at: m.at + 149 }], /gap/);
    bad([{ a: { r: 0, c: 0 }, b: { r: 7, c: 7 }, at: 0 }], /illegal/);
    bad(Array.from({ length: 32 }, () => m), /too many/);
    bad([...run.moves, { ...m, at: run.moves.at(-1)!.at + 150 }], /after game over/);
  });
});
