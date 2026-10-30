import { describe, expect, it } from "vitest";
import {
  BAG_SIZE,
  BATCH_POINTS,
  createTuGame,
  dealBatch,
  hashTuState,
  MAX_TAPS,
  MIN_TAP_GAP_MS,
  ORDER_POINTS,
  PACK_POINTS,
  replayTu,
  TuReplayError,
  type TuEvent,
  type TuGame,
  type TuLogEntry,
  type TuState,
  type TuTap,
} from "@/lib/tu";
import { greedyTu, randomTu } from "../support/tuBot";

const tiersOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));
const TIERS = tiersOf(8);
/** Applies one log entry (tap or prop use) to a live game. */
const step = (g: TuGame, e: TuLogEntry) => ("p" in e ? g.use(e.p) : g.tap(e.id));
/** Greedy without props: every log entry is a tile tap. */
const greedyTaps = (seed: string, maxTaps?: number) => greedyTu(seed, TIERS, { props: false, maxTaps }).taps as TuTap[];

const coveredBy = (s: TuState, id: number) => {
  const t = s.tiles.find((x) => x.id === id)!;
  return s.tiles.some((o) => o.layer > t.layer && Math.abs(o.x - t.x) < 1 && Math.abs(o.y - t.y) < 1);
};

/** Plays the witness of the current batch through `g` and returns all events. */
function playWitness(g: TuGame, seed: string, n = 8): TuEvent[] {
  const s = g.state();
  const ids = s.tiles.map((t) => t.id);
  const out: TuEvent[] = [];
  for (const i of dealBatch(seed, n, s.batch).solution) out.push(...(g.tap(ids[i]) as TuEvent[]));
  return out;
}

describe("createTuGame", () => {
  it("accepts 2-8 tiers only", () => {
    expect(() => createTuGame({ seed: "x", tiers: tiersOf(1) })).toThrow(RangeError);
    expect(() => createTuGame({ seed: "x", tiers: tiersOf(9) })).toThrow(RangeError);
    expect(() => createTuGame({ seed: "x", tiers: tiersOf(2) })).not.toThrow();
  });

  it("rejects the first game's big tier (bread tiers only, D123)", () => {
    expect(() => createTuGame({ seed: "x", tiers: [...tiersOf(3), { id: "big" }] })).toThrow(RangeError);
  });

  it("starts at batch 1 with 24 tiles, an empty bag, two different orders from the board", () => {
    for (let i = 0; i < 50; i++) {
      const s = createTuGame({ seed: `i${i}`, tiers: TIERS }).state();
      expect(s).toMatchObject({ batch: 1, bag: [], score: 0, over: false });
      expect(s.tiles).toHaveLength(24);
      const onBoard = new Set(s.tiles.map((t) => t.tier));
      expect(onBoard.size).toBe(4);
      expect(onBoard.has(s.orders[0]) && onBoard.has(s.orders[1])).toBe(true);
      expect(s.orders[0]).not.toBe(s.orders[1]);
      expect(new Set(s.tiles.map((t) => t.id)).size).toBe(24);
    }
  });

  it("free = nothing on a higher layer overlaps it; coordinates are half-units", () => {
    const s = createTuGame({ seed: "free", tiers: TIERS }).state();
    for (const t of s.tiles) {
      expect(t.free).toBe(!coveredBy(s, t.id));
      expect(Number.isInteger(t.x * 2) && Number.isInteger(t.y * 2)).toBe(true);
    }
    expect(s.tiles.some((t) => t.free) && s.tiles.some((t) => !t.free)).toBe(true);
  });

  it("returns null for covered, unknown and already-taken tiles without changing the state", () => {
    const g = createTuGame({ seed: "null", tiers: TIERS });
    const s = g.state();
    const covered = s.tiles.find((t) => !t.free)!;
    const free = s.tiles.find((t) => t.free)!;
    const h = hashTuState(s);
    expect(g.tap(covered.id)).toBeNull();
    expect(g.tap(9999)).toBeNull();
    expect(g.tap(-1)).toBeNull();
    expect(hashTuState(g.state())).toBe(h);
    expect(g.tap(free.id)).not.toBeNull();
    expect(g.tap(free.id)).toBeNull();
    expect(g.taps).toBe(1);
  });

  it("state() is a copy", () => {
    const g = createTuGame({ seed: "copy", tiers: TIERS });
    const s = g.state();
    s.tiles.length = 0;
    s.bag.push(1);
    s.orders[0] = 99;
    expect(g.state().tiles).toHaveLength(24);
    expect(g.state().bag).toEqual([]);
    expect(g.state().orders[0]).not.toBe(99);
  });
});

describe("bag", () => {
  it("keeps equal tiers grouped, reports the slot, packs 3 at once, and never holds 6 while alive", () => {
    for (let seed = 0; seed < 60; seed++) {
      const taps = seed % 2 ? greedyTaps(`b${seed}`, 300) : (randomTu(`b${seed}`, TIERS).taps as TuTap[]);
      const g = createTuGame({ seed: `b${seed}`, tiers: TIERS });
      for (const tap of taps) {
        const before = g.state().bag;
        const ev = g.tap(tap.id)!;
        const after = g.state();
        const move = ev[0] as Extract<TuEvent, { type: "move" }>;
        expect(move.type).toBe("move");
        // Slot: after the last equal tier, else at the end.
        const last = before.lastIndexOf(move.tier);
        expect(move.slot).toBe(last >= 0 ? last + 1 : before.length);
        const inserted = [...before];
        inserted.splice(move.slot, 0, move.tier);
        const pack = ev.find((e) => e.type === "pack") as Extract<TuEvent, { type: "pack" }> | undefined;
        if (pack) {
          expect(pack.tier).toBe(move.tier);
          expect(inserted.slice(pack.slot, pack.slot + 3)).toEqual([move.tier, move.tier, move.tier]);
          inserted.splice(pack.slot, 3);
        }
        expect(after.bag).toEqual(inserted);
        // Grouped and no triple left.
        for (const t of new Set(after.bag)) {
          const first = after.bag.indexOf(t);
          const n = after.bag.filter((x) => x === t).length;
          expect(n).toBeLessThan(3);
          expect(after.bag.slice(first, first + n).every((x) => x === t)).toBe(true);
        }
        if (after.over) expect(after.bag.length === BAG_SIZE || g.taps === MAX_TAPS).toBe(true);
        else expect(after.bag.length).toBeLessThan(BAG_SIZE);
      }
    }
  });

  it("a full bag without a pack ends the game: move then over, and nothing after", () => {
    const bot = randomTu("over", TIERS);
    expect(bot.over).toBe(true);
    const g = createTuGame({ seed: "over", tiers: TIERS });
    let last: TuEvent[] = [];
    for (const t of bot.taps) last = step(g, t)!;
    expect(last.map((e) => e.type)).toEqual(["move", "bonus", "over"]);
    expect(g.state().bag).toHaveLength(BAG_SIZE);
    const free = g.state().tiles.find((t) => t.free)!;
    expect(g.tap(free.id)).toBeNull();
  });

  it("with only 2 tiers the bag can never fill: the game ends at MAX_TAPS", () => {
    const bot = randomTu("two", tiersOf(2));
    expect(bot.taps).toHaveLength(20_000);
    expect(replayTu("two", tiersOf(2), bot.taps.slice(0, -1)).over).toBe(false);
    expect(bot.over).toBe(true);
    expect(replayTu("two", tiersOf(2), bot.taps)).toMatchObject({ over: true, taps: MAX_TAPS, score: bot.score });
  });
});

describe("scoring and orders", () => {
  it(`pack = ${PACK_POINTS} x batch, order +${ORDER_POINTS} x batch, batch clear +${BATCH_POINTS} x batch`, () => {
    expect([PACK_POINTS, ORDER_POINTS, BATCH_POINTS]).toEqual([10, 30, 100]);
    const g = createTuGame({ seed: "score", tiers: TIERS });
    for (let b = 1; b <= 3; b++) {
      const before = g.score;
      const ev = playWitness(g, "score");
      const packs = ev.filter((e) => e.type === "pack") as Extract<TuEvent, { type: "pack" }>[];
      const hits = packs.filter((p) => p.order).length;
      for (const p of packs) expect(p.points).toBe(b * (PACK_POINTS + (p.order ? ORDER_POINTS : 0)));
      expect(packs).toHaveLength(dealBatch("score", 8, b).tiles.length / 3);
      const batchEv = ev.filter((e) => e.type === "batch");
      expect(batchEv).toEqual([{ type: "batch", batch: b + 1, bonus: BATCH_POINTS * b }]);
      expect(g.score - before).toBe(b * (PACK_POINTS * packs.length + ORDER_POINTS * hits + BATCH_POINTS));
    }
  });

  it("score always equals the sum of pack points, batch bonuses and the end bonus", () => {
    for (let seed = 0; seed < 40; seed++) {
      const bot = greedyTu(`sum${seed}`, TIERS);
      const g = createTuGame({ seed: `sum${seed}`, tiers: TIERS });
      let sum = 0;
      for (const t of bot.taps)
        for (const e of step(g, t)!)
          sum += e.type === "pack" ? e.points : e.type === "batch" ? e.bonus : e.type === "bonus" ? e.points : 0;
      expect(sum).toBe(g.score);
      expect(g.score).toBe(bot.score);
    }
  });

  it("a pack fills the first matching order, which gets a new bread from the board, not the other order's when possible", () => {
    let hits = 0;
    for (let seed = 0; seed < 60; seed++) {
      const g = createTuGame({ seed: `ord${seed}`, tiers: TIERS });
      for (const t of greedyTaps(`ord${seed}`, 400)) {
        const before = g.state().orders;
        const ev = g.tap(t.id)!;
        const s = g.state();
        const pack = ev.find((e) => e.type === "pack") as Extract<TuEvent, { type: "pack" }> | undefined;
        const orderEv = ev.filter((e) => e.type === "order") as Extract<TuEvent, { type: "order" }>[];
        const dealt = ev.some((e) => e.type === "batch");
        if (!pack) {
          expect(orderEv).toEqual([]);
          expect(s.orders).toEqual(before);
          continue;
        }
        const want = before[0] === pack.tier ? 0 : before[1] === pack.tier ? 1 : -1;
        expect(pack.order).toBe(want >= 0);
        if (want >= 0) {
          hits++;
          expect(orderEv[0].index).toBe(want);
        }
        if (!dealt) expect(orderEv.length).toBe(want >= 0 ? 1 : 0);
        for (const o of orderEv) expect(s.orders[o.index]).toBe(o.tier);
        // Unchanged orders keep their tier.
        for (const i of [0, 1] as const) if (!orderEv.some((o) => o.index === i)) expect(s.orders[i]).toBe(before[i]);
        // Refreshed orders: on the board, different from the other one when the board allows it.
        const onBoard = new Set(s.tiles.map((x) => x.tier));
        for (const o of orderEv) {
          if (onBoard.size > 0) expect(onBoard.has(o.tier)).toBe(true);
          if ([...onBoard].some((x) => x !== s.orders[1 - o.index])) expect(o.tier).not.toBe(s.orders[1 - o.index]);
        }
        // After a new batch, both orders want something on the new board.
        if (dealt) for (const i of [0, 1]) expect(onBoard.has(s.orders[i])).toBe(true);
      }
    }
    expect(hits).toBeGreaterThan(100);
  });

  it("tap events come in the order move, pack, reveal, order/gain*, batch, bagSize, bonus, over; prop events start with prop", () => {
    const rank = { prop: 0, move: 0, pack: 1, reveal: 2, order: 3, gain: 3, batch: 4, bagSize: 5, bonus: 6, over: 7 };
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const g = createTuGame({ seed: `ev${seed}`, tiers: TIERS });
      for (const t of greedyTu(`ev${seed}`, TIERS).taps) {
        const ev = step(g, t)!;
        ev.forEach((e) => seen.add(e.type));
        const r = ev.map((e) => rank[e.type]);
        expect(ev[0].type).toBe("p" in t ? "prop" : "move");
        expect([...r].sort((a, b) => a - b)).toEqual(r);
        // A gain comes right after the order event of the order that earned it.
        ev.forEach((e, i) => e.type === "gain" && expect(ev[i - 1].type).toBe("order"));
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(rank).sort());
  });
});

/** Independent check: hidden = each quarter's centre lies inside some tile on a higher layer. */
const hiddenByPoints = (s: TuState, id: number) => {
  const t = s.tiles.find((x) => x.id === id)!;
  return [0.25, 0.75].every((dx) =>
    [0.25, 0.75].every((dy) =>
      s.tiles.some(
        (o) => o.layer > t.layer && o.x <= t.x + dx && t.x + dx < o.x + 1 && o.y <= t.y + dy && t.y + dy < o.y + 1,
      ),
    ),
  );
};

describe("hidden tiles (C7, D128)", () => {
  it("visible = not entirely covered by higher tiles; free tiles are always visible", () => {
    let hidden = 0;
    let partly = 0;
    for (let seed = 0; seed < 40; seed++) {
      const g = createTuGame({ seed: `vis${seed}`, tiers: TIERS });
      for (const tap of greedyTaps(`vis${seed}`, 250)) {
        const s = g.state();
        for (const t of s.tiles) {
          expect(t.visible).toBe(!hiddenByPoints(s, t.id));
          if (t.free) expect(t.visible).toBe(true);
          if (!t.visible) hidden++;
          if (t.visible && !t.free) partly++;
        }
        g.tap(tap.id);
      }
    }
    expect(hidden).toBeGreaterThan(1000);
    expect(partly).toBeGreaterThan(1000);
  });

  it("a hidden tile is never tappable", () => {
    const g = createTuGame({ seed: "hid", tiers: TIERS });
    // Go to batch 3, where many tiles are hidden.
    playWitness(g, "hid");
    playWitness(g, "hid");
    const s = g.state();
    const hidden = s.tiles.filter((t) => !t.visible);
    expect(hidden.length).toBeGreaterThan(10);
    for (const t of hidden) expect(g.tap(t.id)).toBeNull();
  });

  it("reveal lists exactly the tiles that were hidden before the tap and are visible after it", () => {
    let reveals = 0;
    for (let seed = 0; seed < 40; seed++) {
      const g = createTuGame({ seed: `rev${seed}`, tiers: TIERS });
      for (const tap of greedyTaps(`rev${seed}`)) {
        const before = g.state();
        const ev = g.tap(tap.id)!;
        const after = g.state();
        const dealt = ev.some((e) => e.type === "batch");
        const wasHidden = new Set(before.tiles.filter((t) => !t.visible).map((t) => t.id));
        // On a new batch the old board is empty: nothing of it can be revealed.
        const want = dealt ? [] : after.tiles.filter((t) => t.visible && wasHidden.has(t.id)).map((t) => t.id);
        const rev = ev.filter((e) => e.type === "reveal") as Extract<TuEvent, { type: "reveal" }>[];
        expect(rev.length).toBeLessThanOrEqual(1);
        expect(rev[0]?.tiles ?? []).toEqual(want);
        if (rev.length) {
          reveals++;
          expect(rev[0].tiles.length).toBeGreaterThan(0);
        }
      }
    }
    expect(reveals).toBeGreaterThan(200);
  });

  it("every batch from 3 on hides tiles, including tiles stacked exactly under another one", () => {
    for (let seed = 0; seed < 100; seed++) {
      for (let b = 3; b <= 6; b++) {
        const { tiles } = dealBatch(`stk${seed}`, 8, b);
        const hidden = tiles.filter((t) => tiles.some((o) => o.layer > t.layer && o.x2 === t.x2 && o.y2 === t.y2));
        expect(hidden.length).toBeGreaterThan(3);
      }
    }
  });
});

describe("determinism, replay and pinned vectors", () => {
  it("same seed + taps = same states; different seeds deal different boards", () => {
    const bot = greedyTu("det", TIERS);
    const a = createTuGame({ seed: "det", tiers: TIERS });
    const b = createTuGame({ seed: "det", tiers: TIERS });
    for (const t of bot.taps) {
      expect(step(a, t)).toEqual(step(b, t));
      expect(hashTuState(a.state())).toBe(hashTuState(b.state()));
    }
    expect(hashTuState(createTuGame({ seed: "det2", tiers: TIERS }).state())).not.toBe(
      hashTuState(createTuGame({ seed: "det", tiers: TIERS }).state()),
    );
  });

  it("only the tier count matters, not the ids", () => {
    const other = TIERS.map((t, i) => ({ id: `other-${i}` }));
    expect(createTuGame({ seed: "ids", tiers: other }).state()).toEqual(createTuGame({ seed: "ids", tiers: TIERS }).state());
  });

  it("replay == live play for bots over many seeds", () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const bot of [randomTu(`rp${seed}`, TIERS), greedyTu(`rp${seed}`, TIERS)]) {
        expect(replayTu(`rp${seed}`, TIERS, bot.taps)).toEqual({ score: bot.score, over: bot.over, batch: bot.batch, taps: bot.taps.length });
      }
    }
  });

  it("replay of an unfinished run (prefix) is valid and not over", () => {
    const bot = greedyTu("prefix", TIERS);
    const res = replayTu("prefix", TIERS, bot.taps.slice(0, 20));
    expect(res.over).toBe(false);
    expect(res.taps).toBe(20);
    expect(replayTu("prefix", TIERS, [])).toEqual({ score: 0, over: false, batch: 1, taps: 0 });
  });

  it("pinned vector: dealt board and a greedy game never change", () => {
    expect(hashTuState(createTuGame({ seed: "pinned", tiers: TIERS }).state())).toMatchInlineSnapshot(`"e3b5a02c"`);
    const bot = greedyTu("pinned", TIERS);
    const g = createTuGame({ seed: "pinned", tiers: TIERS });
    const revealed: number[] = [];
    for (const t of bot.taps) for (const e of step(g, t)!) if (e.type === "reveal") revealed.push(...e.tiles);
    expect({ score: bot.score, batch: bot.batch, over: bot.over, taps: bot.taps.length, hash: hashTuState(g.state()), revealed: revealed.length }).toMatchInlineSnapshot(`
      {
        "batch": 3,
        "hash": "bc4188e5",
        "over": true,
        "revealed": 53,
        "score": 2390,
        "taps": 106,
      }
    `);
  });

  it("exports the server limits", () => {
    expect(MAX_TAPS).toBe(20_000);
    expect(MIN_TAP_GAP_MS).toBe(120);
  });
});

describe("replay errors", () => {
  const seed = "err";
  const bot = randomTu(seed, TIERS);
  const ok = bot.taps as TuTap[];
  const s0 = createTuGame({ seed, tiers: TIERS }).state();
  const covered = s0.tiles.find((t) => !t.free)!.id;
  const expectErr = (taps: unknown, msg: RegExp) => {
    expect(() => replayTu(seed, TIERS, taps as TuTap[])).toThrow(TuReplayError);
    expect(() => replayTu(seed, TIERS, taps as TuTap[])).toThrow(msg);
  };

  it("rejects anything a real client cannot produce", () => {
    expect(bot.over).toBe(true);
    expect(() => replayTu(seed, TIERS, ok)).not.toThrow();
    expectErr(null, /not an array/);
    expectErr({ length: 1 }, /not an array/);
    expectErr(Array.from({ length: MAX_TAPS + 1 }, (_, i) => ({ id: 1, at: i })), /too many/);
    expectErr([null], /bad tap/);
    expectErr([7], /bad tap/);
    expectErr([{ id: "1", at: 0 }], /bad tile id/);
    expectErr([{ id: 1.5, at: 0 }], /bad tile id/);
    expectErr([{ id: ok[0].id, at: -1 }], /bad tap time/);
    expectErr([{ id: ok[0].id, at: 1.5 }], /bad tap time/);
    expectErr([{ id: ok[0].id, at: Number.NaN }], /bad tap time/);
    expectErr([{ id: ok[0].id }], /^bad tap$/);
    expectErr([ok[0], { ...ok[1], at: ok[0].at }], /not increasing/);
    expectErr([ok[0], { ...ok[1], at: ok[0].at - 1 }], /not increasing/);
    expectErr([{ id: 9999, at: 0 }], /not tappable/);
    expectErr([{ id: covered, at: 0 }], /not tappable/);
    expectErr([ok[0], { id: ok[0].id, at: ok[0].at + 200 }], /not tappable/);
    const after = createTuGame({ seed, tiers: TIERS });
    for (const t of ok) after.tap(t.id);
    const stillFree = after.state().tiles.find((t) => t.free)!;
    expectErr([...ok, { id: stillFree.id, at: ok[ok.length - 1].at + 500 }], /after game over/);
  });

  it("needs 2-8 tiers (a server misconfiguration, not a client error)", () => {
    expect(() => replayTu(seed, tiersOf(1), [])).toThrow(RangeError);
  });
});
