// 兔了个兔 props, end bonus and the C8 log (D131): engine rules, replay of mixed logs, version.

import { describe, expect, it } from "vitest";
import {
  createTuGame,
  dealBatch,
  hashTuState,
  MAX_TAPS,
  ORDER_POINTS,
  PROP_BONUS_POINTS,
  PROP_EVERY_ORDERS,
  replayTu,
  TU_ENGINE_VERSION,
  TU_PROPS,
  TuReplayError,
  tuSeed,
  tuSeedVersion,
  type TuEvent,
  type TuGame,
  type TuLogEntry,
  type TuProp,
} from "@/lib/tu";
import { greedyTu, randomTu } from "../support/tuBot";

const tiersOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));
const TIERS = tiersOf(8);
const step = (g: TuGame, e: TuLogEntry) => ("p" in e ? g.use(e.p) : g.tap(e.id));
const firstFree = (g: TuGame) => g.state().tiles.find((t) => t.free)!.id;

/** Plays the witness of the current batch through `g`. */
function playWitness(g: TuGame, seed: string, n = 8): TuEvent[] {
  const s = g.state();
  const ids = s.tiles.map((t) => t.id);
  const out: TuEvent[] = [];
  for (const i of dealBatch(seed, n, s.batch).solution) out.push(...(g.tap(ids[i]) as TuEvent[]));
  return out;
}

describe("props in the state", () => {
  it("start with 1 of each, a bag of 6 and order rewards of ORDER_POINTS x batch", () => {
    const g = createTuGame({ seed: "p0", tiers: TIERS });
    expect(g.state()).toMatchObject({ props: { peek: 1, bag: 1, swap: 1 }, bagSize: 6, orderPoints: [30, 30] });
    playWitness(g, "p0");
    playWitness(g, "p0");
    expect(g.state().orderPoints).toEqual([3 * ORDER_POINTS, 3 * ORDER_POINTS]);
  });

  it("state().props is a copy", () => {
    const g = createTuGame({ seed: "p1", tiers: TIERS });
    g.state().props.peek = 9;
    expect(g.state().props.peek).toBe(1);
  });
});

describe("use()", () => {
  it("peek only spends the prop (and counts as a log entry)", () => {
    const g = createTuGame({ seed: "peek", tiers: TIERS });
    const before = g.state();
    expect(g.use("peek")).toEqual([{ type: "prop", p: "peek", left: 0 }]);
    expect(g.taps).toBe(1);
    expect({ ...g.state(), props: before.props }).toEqual(before);
    expect(g.state().props).toEqual({ peek: 0, bag: 1, swap: 1 });
    expect(g.use("peek")).toBeNull();
    expect(g.taps).toBe(1);
  });

  it("returns null for an unknown prop, none left, or a second bag in the same batch, without changing anything", () => {
    const g = createTuGame({ seed: "null", tiers: TIERS });
    expect(g.use("shuffle" as TuProp)).toBeNull();
    expect(g.use("bag")?.map((e) => e.type)).toEqual(["prop", "bagSize"]);
    const h = hashTuState(g.state());
    expect(g.use("bag")).toBeNull();
    expect(hashTuState(g.state())).toBe(h);
    expect(g.taps).toBe(1);
  });

  it("swap gives both orders a new bread from the board, different from the old ones and from each other", () => {
    let n = 0;
    for (let seed = 0; seed < 200; seed++) {
      const g = createTuGame({ seed: `sw${seed}`, tiers: TIERS });
      // Batch 3 has all 8 breads, so there is always room for two new ones.
      playWitness(g, `sw${seed}`);
      playWitness(g, `sw${seed}`);
      const before = g.state();
      const ev = g.use("swap")!;
      const after = g.state();
      expect(ev).toEqual([
        { type: "prop", p: "swap", left: before.props.swap - 1 },
        { type: "order", index: 0, tier: after.orders[0] },
        { type: "order", index: 1, tier: after.orders[1] },
      ]);
      const onBoard = new Set(after.tiles.map((t) => t.tier));
      expect(onBoard.size).toBe(8);
      for (const o of after.orders) {
        expect(onBoard.has(o)).toBe(true);
        expect(before.orders).not.toContain(o);
      }
      expect(after.orders[0]).not.toBe(after.orders[1]);
      expect({ ...after, orders: before.orders, props: before.props }).toEqual(before);
      n++;
    }
    expect(n).toBe(200);
  });

  it("the bag prop gives a 7th slot for this batch: 6 in the bag is alive, 7 ends it; back to 6 on the next batch", () => {
    let sixAlive = 0;
    for (let seed = 0; seed < 100; seed++) {
      const g = createTuGame({ seed: `bag${seed}`, tiers: TIERS });
      expect(g.use("bag")).toEqual([
        { type: "prop", p: "bag", left: 0 },
        { type: "bagSize", size: 7 },
      ]);
      while (!g.over) {
        g.tap(firstFree(g));
        const s = g.state();
        if (s.batch > 1) break;
        if (!s.over && s.bag.length === 6) sixAlive++;
        if (s.over) expect(s.bag).toHaveLength(7);
        else expect(s.bag.length).toBeLessThan(7);
      }
    }
    expect(sixAlive).toBeGreaterThan(10);
  });

  it("after a batch with the extra slot the next batch starts with 6 (bagSize event) and the prop works again", () => {
    for (let seed = 0; seed < 50; seed++) {
      const g = createTuGame({ seed: `bb${seed}`, tiers: TIERS });
      g.use("bag");
      const ev = playWitness(g, `bb${seed}`);
      const last = ev.slice(ev.findIndex((e) => e.type === "batch"));
      expect(last).toEqual([
        { type: "batch", batch: 2, bonus: 100 },
        { type: "bagSize", size: 6 },
      ]);
      expect(g.state()).toMatchObject({ bagSize: 6, bag: [] });
      // A won bag prop can be used in batch 2 (if we have one).
      if (g.state().props.bag > 0) expect(g.use("bag")).not.toBeNull();
      // Without the prop, no bagSize event after a batch.
      const h = createTuGame({ seed: `bb${seed}`, tiers: TIERS });
      expect(playWitness(h, `bb${seed}`).some((e) => e.type === "bagSize")).toBe(false);
    }
  });

  it("props are never needed: the witness still clears every batch after any prop use", () => {
    for (let seed = 0; seed < 100; seed++) {
      const g = createTuGame({ seed: `wp${seed}`, tiers: TIERS });
      for (let b = 1; b <= 6; b++) {
        if (b === 2) g.use("swap");
        if (b === 3) g.use("bag");
        if (b === 4) g.use("peek");
        const ev = playWitness(g, `wp${seed}`);
        expect(ev.some((e) => e.type === "over")).toBe(false);
        expect(g.batch).toBe(b + 1);
      }
    }
  });
});

describe("earning props and the end bonus", () => {
  it(`every ${PROP_EVERY_ORDERS}rd filled order grants one prop (seeded), right after that order's event`, () => {
    const kinds = new Set<TuProp>();
    let gains = 0;
    for (let seed = 0; seed < 60; seed++) {
      const g = createTuGame({ seed: `gain${seed}`, tiers: TIERS });
      let filled = 0;
      for (const t of greedyTu(`gain${seed}`, TIERS).taps) {
        const before = g.state().props;
        const ev = step(g, t)!;
        const after = g.state().props;
        const pack = ev.find((e) => e.type === "pack");
        if (pack?.type === "pack" && pack.order) filled++;
        const gain = ev.filter((e) => e.type === "gain") as Extract<TuEvent, { type: "gain" }>[];
        const wantGain = pack?.type === "pack" && pack.order && filled % PROP_EVERY_ORDERS === 0;
        expect(gain).toHaveLength(wantGain ? 1 : 0);
        const used = "p" in t ? t.p : null;
        for (const p of TU_PROPS) {
          const delta = (gain[0]?.p === p ? 1 : 0) - (used === p ? 1 : 0);
          expect(after[p]).toBe(before[p] + delta);
        }
        for (const x of gain) {
          kinds.add(x.p);
          gains++;
        }
      }
    }
    expect(kinds).toEqual(new Set(TU_PROPS));
    expect(gains).toBeGreaterThan(100);
  });

  it(`at the end: +${PROP_BONUS_POINTS} x batch per unused prop, as a bonus event right before over`, () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const bot of [randomTu(`end${seed}`, TIERS), greedyTu(`end${seed}`, TIERS)]) {
        const g = createTuGame({ seed: `end${seed}`, tiers: TIERS });
        let last: TuEvent[] = [];
        for (const t of bot.taps) last = step(g, t)!;
        const s = g.state();
        const unused = s.props.peek + s.props.bag + s.props.swap;
        expect(last.slice(-2)).toEqual([{ type: "bonus", points: PROP_BONUS_POINTS * s.batch * unused }, { type: "over" }]);
        expect(g.score).toBe(bot.score);
      }
    }
    // The random tapper never uses props: 3 left in batch 1 = +150.
    const g = createTuGame({ seed: "end0", tiers: TIERS });
    const bot = randomTu("end0", TIERS);
    expect(bot.batch).toBe(1);
    let pts = 0;
    for (const t of bot.taps) for (const e of step(g, t)!) if (e.type === "bonus") pts = e.points;
    expect(pts).toBe(150);
  });

  it("a bonus of 0 is still sent when every prop was used", () => {
    const g = createTuGame({ seed: "zero", tiers: TIERS });
    for (const p of TU_PROPS) g.use(p);
    let last: TuEvent[] = [];
    while (!g.over) last = g.tap(firstFree(g))!;
    expect(last.slice(-2)).toEqual([{ type: "bonus", points: 0 }, { type: "over" }]);
  });

  it("MAX_TAPS counts prop uses too; a prop use that reaches it ends the game", () => {
    // With 2 breads the bag never fills, so the game runs to the cap.
    const g = createTuGame({ seed: "cap", tiers: tiersOf(2) });
    g.use("peek");
    while (g.taps < MAX_TAPS - 1) g.tap(firstFree(g));
    const props = g.state().props;
    expect(props.swap).toBeGreaterThan(0);
    expect(g.use("swap")!.slice(-2).map((e) => e.type)).toEqual(["bonus", "over"]);
    expect(g.over).toBe(true);
    expect(g.taps).toBe(MAX_TAPS);
    expect(g.use("bag")).toBeNull();
  });
});

describe("replay of mixed logs (C8)", () => {
  it("replay == live play for greedy bots that use props", () => {
    let used = 0;
    for (let seed = 0; seed < 100; seed++) {
      const bot = greedyTu(`mix${seed}`, TIERS);
      used += bot.taps.filter((t) => "p" in t).length;
      expect(replayTu(`mix${seed}`, TIERS, bot.taps)).toEqual({ score: bot.score, over: bot.over, batch: bot.batch, taps: bot.taps.length });
    }
    expect(used).toBeGreaterThan(200);
  });

  it("rejects malformed or unusable prop entries", () => {
    const seed = "perr";
    const tap = { id: createTuGame({ seed, tiers: TIERS }).state().tiles.find((t) => t.free)!.id, at: 100 };
    const bad = (log: unknown, msg: RegExp) => {
      expect(() => replayTu(seed, TIERS, log as TuLogEntry[])).toThrow(TuReplayError);
      expect(() => replayTu(seed, TIERS, log as TuLogEntry[])).toThrow(msg);
    };
    expect(() => replayTu(seed, TIERS, [{ p: "peek", at: 0 }, tap, { p: "bag", at: 200 }, { p: "swap", at: 300 }])).not.toThrow();
    bad([{ p: "shuffle", at: 0 }], /bad prop/);
    bad([{ p: 1, at: 0 }], /bad prop/);
    bad([{ p: "peek" }], /^bad tap$/);
    bad([{ p: "peek", at: 0, id: tap.id }], /^bad tap$/);
    bad([{ p: "peek", at: 0, x: 1 }], /^bad tap$/);
    bad([{ at: 0 }], /^bad tap$/);
    bad([{ p: "peek", at: -1 }], /bad tap time/);
    bad([{ p: "peek", at: 0 }, { p: "peek", at: 10 }], /prop not usable/);
    bad([{ p: "bag", at: 0 }, { p: "bag", at: 10 }], /prop not usable/);
    bad([{ p: "peek", at: 100 }, { ...tap, at: 100 }], /not increasing/);
    bad([{ ...tap, at: 100 }, { p: "peek", at: 50 }], /not increasing/);
    bad(Array.from({ length: MAX_TAPS + 1 }, (_, i) => ({ p: "peek", at: i })), /too many/);
    // Nothing after game over, props included.
    const bot = randomTu(seed, TIERS);
    bad([...bot.taps, { p: "peek", at: bot.taps[bot.taps.length - 1].at + 500 }], /after game over/);
  });

  it("pinned vector: a greedy game with props never changes", () => {
    const bot = greedyTu("pinned", TIERS);
    const g = createTuGame({ seed: "pinned", tiers: TIERS });
    for (const t of bot.taps) step(g, t);
    expect({
      score: bot.score,
      batch: bot.batch,
      taps: bot.taps.length,
      props: bot.taps.filter((t) => "p" in t).map((t) => ("p" in t ? t.p : "")),
      hash: hashTuState(g.state()),
    }).toMatchInlineSnapshot(`
      {
        "batch": 3,
        "hash": "fd258f9a",
        "props": [
          "peek",
          "bag",
          "peek",
          "peek",
        ],
        "score": 2540,
        "taps": 107,
      }
    `);
  });
});

describe("engine version (C8)", () => {
  it(`is ${TU_ENGINE_VERSION}, and new seeds carry it; plain hex seeds are version 1`, () => {
    expect(TU_ENGINE_VERSION).toBe(3);
    const s = tuSeed("0123456789abcdef0123456789abcdef");
    expect(s).toBe("v3.0123456789abcdef0123456789abcdef");
    expect(tuSeedVersion(s)).toBe(3);
    expect(tuSeedVersion("0123456789abcdef0123456789abcdef")).toBe(1);
    expect(tuSeedVersion("v3.abc")).toBe(3);
    expect(tuSeedVersion("v2.")).toBe(1);
    expect(tuSeedVersion("pinned")).toBe(1);
  });
});
