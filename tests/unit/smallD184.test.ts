import { expect, it } from "vitest";
import { createM3Game, legalM3Moves } from "@/lib/m3";
import { createTuGame, dealBatch, replayTu, STOP_TILE_ID, type TuLogEntry } from "@/lib/tu";
import { createGame, defaultTierDefs } from "@/lib/game/engine";

it("reports settled M3 wave counts and failure gaps without changing event points", () => {
  const g = createM3Game({ seed: "gap", tiers: Array.from({ length: 6 }, (_, i) => ({ id: `${i}` })), moves: 1, target: 1000000 });
  const move = legalM3Moves(g.state())[0];
  const events = g.swap(move.a, move.b)!;
  const points = events.reduce((sum, e) => sum + (e.type === "match" ? e.points : e.type === "order" && e.action === "complete" ? e.order.points : 0), 0);
  expect(g.score).toBe(points);
  expect(g.state().lastCascadeWaves).toBe(events.filter(e => e.type === "match").length);
  expect(g.state().failureGap).toEqual({ pointsShort: 1000000 - points, orders: g.state().orders.map((o, index) => ({ index, tier: o.tier, itemsShort: o.need - o.have })) });
});

it("allows TU cash-out only at a cleared-oven boundary, replaying its bonus once", () => {
  const seed = "cash-out", tiers = Array.from({ length: 8 }, (_, i) => ({ id: `${i}` }));
  const g = createTuGame({ seed, tiers });
  expect(g.stop()).toBeNull();
  const ids = g.state().tiles.map(t => t.id);
  const log: TuLogEntry[] = [];
  for (const i of dealBatch(seed, 8, 1).solution) {
    g.tap(ids[i]); log.push({ id: ids[i], at: log.length * 500 });
  }
  expect(g.state().canStop).toBe(true);
  const before = g.score;
  const props = g.state().props;
  expect(g.stop()).toEqual([{ type: "bonus", points: 50 * (props.peek + props.bag + props.swap) }, { type: "over" }]);
  log.push({ id: STOP_TILE_ID, at: log.length * 500 });
  expect(replayTu(seed, tiers, log).score).toBe(g.score);
  expect(g.score).toBeGreaterThan(before);
  expect(g.stop()).toBeNull();
  expect(() => replayTu(seed, tiers, [...log, { id: STOP_TILE_ID, at: log.length * 500 }])).toThrow();
  expect(() => replayTu(seed, tiers, [{ id: STOP_TILE_ID, at: 0 }])).toThrow();
});

it("tracks BIG highest reached tier monotonically, with a terminal next tier", () => {
  const g = createGame({ seed: "milestone", tiers: defaultTierDefs(["a"]), width: 1, height: 1.5 });
  expect(g.state().highestTier).toBeNull();
  expect(g.state().nextTier).toBe(0);
  g.drop(.5);
  for (let i = 0; i < 180; i++) g.step();
  g.drop(.5);
  for (let i = 0; i < 180; i++) g.step();
  expect(g.state().highestTier).toBe(1);
  expect(g.state().nextTier).toBeNull();
  expect(g.drainEvents().flatMap(e => e.type !== "over" && e.milestone ? [e.milestone] : [])).toEqual([
    { highestTier: 0, nextTier: 1 },
    { highestTier: 1, nextTier: null },
  ]);
});

it("closes the TU cash-out window on the next accepted input but not on an invalid tap", () => {
  const seed = "boundary", tiers = Array.from({ length: 8 }, (_, i) => ({ id: `${i}` }));
  for (const prop of [false, true]) {
    const g = createTuGame({ seed, tiers });
    const ids = g.state().tiles.map(t => t.id);
    for (const i of dealBatch(seed, 8, 1).solution) g.tap(ids[i]);
    expect(g.tap(-1)).toBeNull();
    expect(g.state().canStop).toBe(true);
    if (prop) g.use("peek");
    else g.tap(g.state().tiles.find(t => t.free)!.id);
    expect(g.state().canStop).toBe(false);
    expect(g.stop()).toBeNull();
  }
});

it("rejects old BIG production saves at reconstruction", () => {
  const tiers = defaultTierDefs(["a"]);
  for (const seed of ["0123456789abcdef0123456789abcdef", "v1.abcdef", "v3.abcdef"]) {
    expect(() => createGame({ seed, tiers, width: 1, height: 1.5 })).toThrow("expired seed");
  }
});
