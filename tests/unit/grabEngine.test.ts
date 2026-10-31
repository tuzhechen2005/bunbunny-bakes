import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import {
  createGrabGame, replayGrab, GrabReplayError, GRAB_ENGINE_VERSION,
  RUN_TICKS, MAX_RUN_TICKS, MAX_LAUNCHES, MAX_IGNORED_LAUNCHES,
  breadStage, breadPoints, reelSpeed, EXTEND_SPEED, REFILL_DELAY_TICKS,
  SWING_PERIOD_TICKS, FIELD_WIDTH, FIELD_HEIGHT, EMPTY_REEL_SPEED,
  type GrabEvent, type GrabItem,
} from "@/lib/grab";
import { circleIntersectsSegment, firstContact, fieldLength, swingAngle } from "@/lib/grab/geometry";
import { greedyGrab, randomGrab } from "../support/grabBot";

const tiers = (n = 6) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));

// Find real seeded fixtures through the public state, without exposing a board-injection API.
function fixture(
  predicate: (item: GrabItem, contactTick: number, distance: number) => boolean,
  from = 0, to = SWING_PERIOD_TICKS,
) {
  for (let seedIndex = 0; seedIndex < 1000; seedIndex++) {
    const seed = `fixture${seedIndex}`;
    const game = createGrabGame({ seed, tiers: tiers() });
    const items = game.state().items;
    for (let at = from; at <= to; at++) {
      const angle = swingAngle(at);
      const hit = firstContact(angle, 0, fieldLength(angle), items);
      if (!hit) continue;
      const contactTick = at + Math.ceil(hit.length / EXTEND_SPEED);
      if (!predicate(items[hit.index], contactTick, hit.length)) continue;
      game.launch(at);
      game.step(contactTick);
      expect(game.state().claw.held?.id).toBe(items[hit.index].id);
      return { game, seed, at, contactTick };
    }
  }
  throw new Error("grab fixture not found");
}

describe("grab engine", () => {
  it("requires at least three tiers and exports the revised replay version", () => {
    for (let n = 0; n < 3; n++) {
      expect(() => createGrabGame({ seed: "x", tiers: tiers(n) })).toThrow(RangeError);
      expect(() => replayGrab("x", tiers(n), [])).toThrow(RangeError);
    }
    expect(GRAB_ENGINE_VERSION).toBe(3);
    expect(createGrabGame({ seed: "x", tiers: tiers(10) }).state().items).toHaveLength(8);
  });

  it("pins raw/perfect/burnt boundaries and exact integer multipliers", () => {
    expect([0, 239, 240, 540, 541].map(breadStage)).toEqual(["raw", "raw", "perfect", "perfect", "burnt"]);
    expect([239, 240, 540, 541].map((age) => breadPoints("S", age))).toEqual([50, 150, 150, 30]);
    for (const size of ["S", "M", "L"] as const) {
      expect(breadPoints(size, 240)).toBe(breadPoints(size, 0) * 3);
      expect(Number.isInteger(breadPoints(size, 541))).toBe(true);
    }
  });

  it("detects swept tip contact, tangency, endpoints and zero-length segments", () => {
    const hit = (x: number, y: number, r: number) => circleIntersectsSegment(x, y, r, 0, 0, 12, 0);
    expect(hit(6, 0, 1)).toBe(true); // Neither endpoint lies in this circle.
    expect(hit(6, 2, 2)).toBe(true);
    expect(hit(6, 3, 2)).toBe(false);
    expect(hit(14, 0, 2)).toBe(true);
    expect(hit(-3, 0, 2)).toBe(false);
    expect(circleIntersectsSegment(0, 0, 1, 1, 0, 1, 0)).toBe(true);
  });

  it("starts with integer, non-overlapping seeded items inside the lower field", () => {
    for (let i = 0; i < 200; i++) {
      const g = createGrabGame({ seed: `initial${i}`, tiers: tiers() });
      const s = g.state();
      expect(s).toMatchObject({ tick: 0, timeLeft: RUN_TICKS, score: 0, over: false, grabs: 0 });
      expect(s.items).toHaveLength(8);
      for (const a of s.items) {
        expect([a.x, a.y, a.radius, a.age, a.weight].every(Number.isSafeInteger)).toBe(true);
        expect(a.y - a.radius).toBeGreaterThanOrEqual(FIELD_HEIGHT * .3);
        expect(a.x - a.radius).toBeGreaterThanOrEqual(0);
        expect(a.x + a.radius).toBeLessThanOrEqual(FIELD_WIDTH);
        expect(a.y + a.radius).toBeLessThanOrEqual(FIELD_HEIGHT);
        if (a.kind === "bread") expect(a.tier).toBeGreaterThanOrEqual(0);
        for (const b of s.items) if (a.id !== b.id) {
          expect((a.x - b.x) ** 2 + (a.y - b.y) ** 2).toBeGreaterThan((a.radius + b.radius) ** 2);
        }
      }
    }
  });

  it("spreads enlarged bread across the lower 70%", () => {
    const items = Array.from({ length: 200 }, (_, i) => createGrabGame({ seed: `spread${i}`, tiers: tiers() }).state().items).flat();
    expect(Math.min(...items.map(i => i.y - i.radius))).toBeLessThan(FIELD_HEIGHT * .35);
    expect(Math.max(...items.map(i => i.y + i.radius))).toBeGreaterThan(FIELD_HEIGHT * .95);
    for (const item of items.filter(i => i.kind === "bread")) {
      expect(item.radius).toBe({ S: 41, M: 57, L: 73 }[item.size]);
    }
  });

  it("swings ±70 degrees periodically and locks its angle until fully reeled", () => {
    expect([0, 75, 150, 225, 300].map(swingAngle)).toEqual([-70, 0, 70, 0, -70]);
    const g = createGrabGame({ seed: "swing", tiers: tiers() });
    g.launch(0);
    g.step(1);
    expect(g.state().claw).toMatchObject({ phase: "extending", angle: -70, length: EXTEND_SPEED });
    g.step(2);
    expect(g.state().claw.length).toBe(2 * EXTEND_SPEED);
    while (g.state().claw.phase === "extending") g.step(g.state().tick + 1);
    const s = g.state();
    expect(s.claw).toMatchObject({ phase: "reeling", angle: -70, held: null });
    expect(s.claw.length).toBe(fieldLength(-70));
    // The shortest miss must stay readable: roughly 0.47 s each way at 60 Hz.
    expect(s.tick).toBe(28);
    g.step(s.tick + 1);
    expect(g.state().claw.length).toBe(s.claw.length - EMPTY_REEL_SPEED);
    while (g.state().claw.phase !== "idle") g.step(g.state().tick + 1);
    expect(g.state().tick - s.tick).toBe(28);
    expect(g.state().claw).toMatchObject({ angle: swingAngle(g.state().tick), length: 0 });
    expect([0, 1, 2, 3, 8].map(reelSpeed)).toEqual([17, 13, 9, 5, 2]);
  });

  it("hits the first item along the tip path rather than the first array entry", () => {
    const items = [{ x: 360, y: 250, radius: 10 }, { x: 360, y: 150, radius: 10 }];
    expect(firstContact(0, 0, 600, items)).toEqual({ index: 1, length: 140 });
  });

  it.each([239, 240, 540, 541])("locks doneness at contact tick %i, not at delivery", (age) => {
    const { game, contactTick } = fixture((item, tick) => item.kind === "bread" && tick === age, age - 60, age);
    const held = game.state().claw.held!;
    expect(held.age).toBe(age);
    expect(held.stage).toBe(breadStage(age));
    expect(game.score).toBe(0);
    while (game.state().claw.phase !== "idle") {
      if (game.state().claw.held) expect(game.state().claw.held?.stage).toBe(held.stage);
      game.step(game.state().tick + 1);
    }
    expect(game.state().tick).toBeGreaterThan(contactTick);
    expect(game.score).toBe(breadPoints(held.size, age));
    expect(game.grabs).toBe(1);
  });

  it("awards a clock's 300 ticks only on delivery, then expires at 3900", () => {
    const { game, contactTick } = fixture((item) => item.kind === "clock");
    expect(game.state().timeLeft).toBe(RUN_TICKS - contactTick);
    expect(game.grabs).toBe(0);
    while (game.state().claw.phase !== "idle") game.step(game.state().tick + 1);
    expect(game.state().events).toContainEqual(expect.objectContaining({ type: "score", points: 0, bonusTicks: 300 }));
    expect(game.state().timeLeft).toBe(RUN_TICKS + 300 - game.state().tick);
    game.step(MAX_RUN_TICKS);
    expect(game.state()).toMatchObject({ tick: 3900, timeLeft: 0, over: true, grabs: 1, score: 0 });
  });

  it.each(["bread", "clock"] as const)("does not deliver a held %s at the timeout tick", (kind) => {
    const { game } = fixture((item, contact, distance) =>
      item.kind === kind && contact < RUN_TICKS && contact + Math.ceil(distance / reelSpeed(item.weight)) === RUN_TICKS,
    RUN_TICKS - 200, RUN_TICKS - 20);
    expect(game.state().claw.held?.kind).toBe(kind);
    game.step(RUN_TICKS - 1);
    expect(game.state().claw.length).toBeLessThanOrEqual(reelSpeed(game.state().claw.held!.weight));
    game.step(RUN_TICKS);
    expect(game.state()).toMatchObject({ tick: RUN_TICKS, score: 0, grabs: 0, over: true, timeLeft: 0 });
    expect(game.state().events.some((e) => e.type === "score")).toBe(false);
    expect(game.state().claw.held?.kind).toBe(kind);
  });

  it.each(["flour", "butter"] as const)("does not apply doneness multipliers to %s", (kind) => {
    for (const from of [0, 600]) {
      const { game } = fixture((item) => item.kind === kind, from, from + SWING_PERIOD_TICKS);
      expect(game.state().claw.held?.stage).toBe("none");
      while (game.state().claw.phase !== "idle") game.step(game.state().tick + 1);
      expect(game.score).toBe(20);
      expect(game.state().timeLeft).toBe(RUN_TICKS - game.state().tick);
    }
  });

  it("refills after the delay from the oven, and returns detached items, held items and events", () => {
    const { game, contactTick, seed, at } = fixture((item) => item.kind === "bread" && item.size === "L");
    const s = game.state();
    expect(s.items).toHaveLength(7);
    s.items[0].x = -999;
    s.claw.held!.weight = 1000;
    const pop = s.events.find((e) => e.type === "pop")!;
    if (pop.type === "pop") pop.item.age = 9999;
    const twin = createGrabGame({ seed, tiers: tiers() });
    twin.launch(at); twin.step(contactTick);
    expect(game.state()).toEqual(twin.state());
    game.step(contactTick + REFILL_DELAY_TICKS - 1);
    expect(game.state().items).toHaveLength(7);
    const events = game.step(contactTick + REFILL_DELAY_TICKS);
    expect(game.state().items).toHaveLength(8);
    const refill = events.find((e) => e.type === "refill")!;
    expect(refill).toMatchObject({ type: "refill", tick: contactTick + REFILL_DELAY_TICKS, from: { x: 680, y: 80 }, item: { age: 0 } });
    if (refill.type === "refill") { refill.item.x = -999; refill.from.x = -999; }
    expect(game.state().events).not.toEqual(events);
    twin.step(contactTick + REFILL_DELAY_TICKS);
    expect(game.state()).toEqual(twin.state());
  });

  it("ends exactly at zero and bounds even enormous step requests", () => {
    const g = createGrabGame({ seed: "timeout", tiers: tiers() });
    g.step(RUN_TICKS - 1);
    expect(g.state()).toMatchObject({ over: false, timeLeft: 1 });
    expect(g.launch(RUN_TICKS - 1)).toBe(true);
    expect(g.step(Number.MAX_SAFE_INTEGER)).toEqual([{ type: "over", tick: RUN_TICKS }]);
    expect(g.state()).toMatchObject({ over: true, tick: RUN_TICKS, timeLeft: 0, score: 0 });
    expect(g.launch(RUN_TICKS + 1)).toBe(false);
  });

  it.each([3, 6, 10])("matches live, replay and differently chunked stepping (%i tiers)", (n) => {
    for (let i = 0; i < 12; i++) for (const bot of [greedyGrab, randomGrab]) {
      const seed = `live${i}`;
      const run = bot(seed, tiers(n));
      const a = createGrabGame({ seed, tiers: tiers(n) });
      const b = createGrabGame({ seed, tiers: tiers(n) });
      const eventsA: GrabEvent[] = [], eventsB: GrabEvent[] = [];
      let tick = 0;
      for (const launch of run.launches) {
        while (tick < launch) eventsB.push(...b.step(++tick));
        a.launch(launch); b.launch(launch);
        eventsA.push(...a.state().events); eventsB.push(...b.state().events);
      }
      eventsA.push(...a.step(MAX_RUN_TICKS));
      while (!b.over) eventsB.push(...b.step(++tick));
      expect(eventsA).toEqual(eventsB);
      expect({ ...a.state(), events: [] }).toEqual({ ...b.state(), events: [] });
      expect(replayGrab(seed, tiers(n), run.launches)).toEqual({
        score: run.score, over: true, grabs: run.grabs, launchesAccepted: run.launchesAccepted,
      });
      expect(a.score).toBe(eventsA.reduce((sum, e) => sum + (e.type === "score" ? e.points : 0), 0));
    }
  }, 30_000);

  it("keeps all refills in bounds, separated, uniquely identified and integer-valued", () => {
    for (let i = 0; i < 20; i++) {
      const seed = `refills${i}`;
      const run = greedyGrab(seed, tiers());
      const game = createGrabGame({ seed, tiers: tiers() });
      const seen = new Set(game.state().items.map((item) => item.id));
      for (const at of [...run.launches, MAX_RUN_TICKS]) {
        if (at === MAX_RUN_TICKS) game.step(at); else game.launch(at);
        const state = game.state();
        for (const e of state.events) if (e.type === "refill") {
          expect(seen.has(e.item.id)).toBe(false);
          seen.add(e.item.id);
        }
        const integersOnly = (value: unknown): void => {
          if (typeof value === "number") expect(Number.isSafeInteger(value)).toBe(true);
          else if (value && typeof value === "object") Object.values(value).forEach(integersOnly);
        };
        integersOnly(state);
        expect(state.items.length).toBeGreaterThanOrEqual(7);
        expect(state.items.length).toBeLessThanOrEqual(8);
        for (const a of state.items) {
          expect(a.x - a.radius >= 0 && a.x + a.radius <= FIELD_WIDTH).toBe(true);
          expect(a.y - a.radius >= FIELD_HEIGHT * .3 && a.y + a.radius <= FIELD_HEIGHT).toBe(true);
          for (const b of state.items) if (a.id !== b.id) {
            expect((a.x - b.x) ** 2 + (a.y - b.y) ** 2).toBeGreaterThan((a.radius + b.radius) ** 2);
          }
        }
      }
      expect(game.state().tick).toBeLessThan(MAX_RUN_TICKS);
    }
  });

  it("rejects invalid live times without changing state", () => {
    const g = createGrabGame({ seed: "time", tiers: tiers() });
    g.step(10);
    const before = g.state();
    for (const tick of [-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => g.step(tick)).toThrow(RangeError);
      expect(() => g.launch(tick)).toThrow(RangeError);
      expect(g.state()).toEqual(before);
    }
    expect(g.launch(10)).toBe(true);
    expect(() => g.launch(10)).toThrow(RangeError);
    expect(g.launch(11)).toBe(false);
    expect(g.state().launchesRejected).toBe(1);
  });
});

describe("grab replay validation", () => {
  const bad = (log: unknown, message: RegExp) => {
    expect(() => replayGrab("errors", tiers(), log as number[])).toThrow(GrabReplayError);
    expect(() => replayGrab("errors", tiers(), log as number[])).toThrow(message);
  };
  it("validates shape, safe ticks, ordering, bounds and launches after timeout", () => {
    bad(null, /array/); bad({}, /array/);
    for (const entry of [null, {}, "1", -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) bad([entry], /tick/);
    bad([0, 0], /increasing/); bad([2, 1], /increasing/);
    bad(Array(MAX_LAUNCHES + 1).fill(0), /too many launches/);
    bad([RUN_TICKS], /after game over/);
  });
  it("allows some ignored taps but rejects a flood", () => {
    expect(replayGrab("errors", tiers(), [0, 1, 2]).launchesAccepted).toBe(1);
    bad(Array.from({ length: MAX_IGNORED_LAUNCHES + 20 }, (_, i) => i), /too many ignored/);
  });
  it("supports explicit progress ticks, with no future score credit", () => {
    expect(replayGrab("empty", tiers(), [], 0)).toEqual({ score: 0, over: false, grabs: 0, launchesAccepted: 0 });
    expect(replayGrab("empty", tiers(), [])).toEqual({ score: 0, over: true, grabs: 0, launchesAccepted: 0 });
    expect(() => replayGrab("errors", tiers(), [20], 10)).toThrow(GrabReplayError);
    expect(() => replayGrab("errors", tiers(), [], -1)).toThrow(GrabReplayError);
  });

  it("replays a full clock-extended run with the maximum ignored inputs in under 50 ms", () => {
    const { seed, run } = Array.from({ length: 40 }, (_, i) => {
      const seed = `grab-tune${i}`;
      return { seed, run: greedyGrab(seed, tiers()) };
    }).sort((a, b) => b.run.ticks - a.run.ticks)[0];
    const game = createGrabGame({ seed, tiers: tiers() });
    const launches: number[] = [];
    const intended = new Set(run.launches);
    while (!game.over) {
      const state = game.state();
      if (intended.has(state.tick) || (state.claw.phase !== "idle" && game.launchesRejected < MAX_IGNORED_LAUNCHES)) {
        launches.push(state.tick);
        game.launch(state.tick);
      }
      game.step(state.tick + 1);
    }
    expect(game.launchesRejected).toBe(MAX_IGNORED_LAUNCHES);
    expect(game.state().tick).toBeGreaterThan(RUN_TICKS);
    const expected = { score: game.score, over: true, grabs: game.grabs, launchesAccepted: game.launchesAccepted };
    expect(replayGrab(seed, tiers(), launches)).toEqual(expected); // Warm up.
    const timings = Array.from({ length: 7 }, () => {
      const start = performance.now();
      const result = replayGrab(seed, tiers(), launches, MAX_RUN_TICKS);
      const elapsed = performance.now() - start;
      expect(result).toEqual(expected);
      return elapsed;
    }).sort((a, b) => a - b);
    expect(timings[6]).toBeLessThan(50);
    // A maximal-size hostile log is also bounded and rejected before a long simulation.
    const start = performance.now();
    expect(() => replayGrab(seed, tiers(), Array.from({ length: MAX_LAUNCHES }, (_, i) => i))).toThrow(GrabReplayError);
    expect(performance.now() - start).toBeLessThan(50);
    process.stdout.write(`G1 full replay: median=${timings[3].toFixed(2)}ms max=${timings[6].toFixed(2)}ms\n`);
  });
});
