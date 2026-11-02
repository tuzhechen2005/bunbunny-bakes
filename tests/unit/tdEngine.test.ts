import { describe, expect, it } from "vitest";
import {
  createTdGame, replayTd, tdLevel, tdSeedVersion, TD_ENGINE_VERSION,
  FIELD_WIDTH, FIELD_HEIGHT, TD_SLOT_RADIUS, SUBUNITS, MAX_LEVEL_TICKS, MAX_INPUTS, MAX_IGNORED_INPUTS, TD_MAPS, pathLength, pathPosition,
  towerStats, PESTS, distanceSquared, type TdEvent, type TdInput,
} from "@/lib/td";
import { greedyTd, randomTd } from "../support/tdBot";

const level = () => tdLevel("2026-10-26", 1);

describe("TD deterministic level and geometry", () => {
  it("pins the version and generates five shared weekly waves", () => {
    expect(TD_ENGINE_VERSION).toBe(11);
    expect(tdSeedVersion(level().seed)).toBe(TD_ENGINE_VERSION);
    expect([1, 10, 11, 20, 21].map(n => tdLevel("2026-10-26", n).startCoins)).toEqual([75, 390, 390, 720, 720]);
    expect(level()).toEqual(level());
    expect(level().waves).toHaveLength(5);
    expect(tdLevel("2026-11-02", 1).waves).not.toEqual(level().waves);
    for (let n = 1; n <= 25; n++) {
      const l = tdLevel("2026-10-26", n);
      expect(l.map).toBe(Math.floor((n - 1) / 4) % 3);
      const kinds = l.waves.flatMap(w => w.pests.map(p => p.kind));
      expect(kinds.includes("sparrow")).toBe(n >= 4);
      expect(kinds.includes("beetle")).toBe(n >= 5);
    }
  });

  it("reduces movement and early counts while preserving integer tower damage", () => {
    for (const n of [1, 3, 5, 10, 20]) {
      const l = tdLevel("2026-10-26", n);
      for (const [wave, w] of l.waves.entries()) {
        const ordinary = w.pests.filter(p => !p.boss);
        const baseCount = Math.min(96, 9 + Math.floor((n - 1) * 1.5) + [0, 3, 6, 2, 12][wave]);
        const percent = n <= 5 ? 70 : 100;
        expect(ordinary.length).toBeGreaterThanOrEqual(Math.round(Math.floor(baseCount * percent / 100) * 0.6));
        expect(ordinary.length).toBeLessThanOrEqual(Math.round(Math.floor((baseCount + 2) * percent / 100) * 0.6));
        for (const p of ordinary) expect(p.speed).toBe(n === 1 ? 24 : Math.floor(PESTS[p.kind].speed * (100 + Math.min(150, (n - 1) * 3)) * 80 / 10000));
        for (const p of w.pests.filter(p => p.boss)) expect(p.speed).toBe(n === 1 ? 24 : 16);
      }
    }
    expect(["rollingPin", "whisk", "oven"].map(k => towerStats(k as "rollingPin" | "whisk" | "oven").damage)).toEqual([24, 29, 124]);
  });

  it("validates canonical weekly seeds and regenerates untrusted descriptors", () => {
    for (const week of ["2026-10-27", "2026-02-30", "2026-13-01", "2026-00-01", "0000-01-01", "week"]) {
      expect(() => tdLevel(week, 1)).toThrow();
    }
    for (const n of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => tdLevel("2026-10-26", n)).toThrow();
    for (const seed of ["unversioned", "v1.td.2026-10-26.1", "v3.td.2026-10-26.1", "v4.td.2026-10-26.1", "v5.td.2026-10-26.1", "v6.td.2026-10-26.1", "v7.td.2026-10-26.1", "v8.td.2026-10-26.1", "v9.td.2026-10-26.1", "v10.td.2026-10-26.1", "v2.td.2026-10-26.01", "v2.td.2026-02-30.1"]) {
      expect(() => createTdGame({ seed })).toThrow();
    }
    for (const tierCount of [0, 101, 1.5, NaN]) expect(() => createTdGame({ level: level(), tierCount })).toThrow();
    const tampered = level();
    tampered.waves[0].pests[0].hp = 1; tampered.startCoins = 1000000; tampered.map = 2;
    expect(createTdGame({ level: tampered }).state()).toEqual(createTdGame({ level: level() }).state());
    expect(tdLevel("2026-10-26", Number.MAX_SAFE_INTEGER).waves.flatMap(w => w.pests).length).toBeLessThanOrEqual(291);
  });

  it("keeps all three winding paths and eleven off-path slots in the landscape field", () => {
    expect([FIELD_WIDTH, FIELD_HEIGHT]).toEqual([1440, 810]);
    expect(TD_MAPS).toHaveLength(3);
    for (const map of TD_MAPS) {
      expect(map.slots).toHaveLength(11);
      expect(map.path[0].y).toBe(0);
      expect(pathLength(map) / SUBUNITS).toBeGreaterThan(2600);
      const plate = map.path.at(-1)!;
      expect(plate.x).toBeGreaterThan(115);
      expect(plate.x + 115).toBeLessThan(FIELD_WIDTH);
      expect(plate.y).toBeGreaterThan(115);
      expect(plate.y + 115).toBeLessThan(FIELD_HEIGHT);
      for (const slot of map.slots) {
        expect(slot.x).toBeGreaterThan(TD_SLOT_RADIUS);
        expect(slot.y).toBeGreaterThan(TD_SLOT_RADIUS);
        let covered = false;
        for (let d = 0; d < pathLength(map); d += SUBUNITS * 10) {
          if (distanceSquared(slot, pathPosition(map, d)) <= towerStats('whisk').range ** 2) covered = true;
        }
        expect(covered).toBe(true);
      }
      expect(map.path.length).toBeGreaterThanOrEqual(6);
      for (const p of [...map.path, ...map.slots]) {
        expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1440);
        expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(810);
      }
      for (let i = 1; i < map.path.length; i++) {
        const a = map.path[i - 1], b = map.path[i];
        expect(a).not.toEqual(b);
        for (const slot of map.slots) {
          const x = Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), slot.x));
          const y = Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), slot.y));
          expect((slot.x - x) ** 2 + (slot.y - y) ** 2).toBeGreaterThanOrEqual(79 ** 2);
        }
        // Non-neighbouring axis-aligned segments must not cross or touch.
        for (let j = i + 2; j < map.path.length; j++) {
          const c = map.path[j - 1], d = map.path[j];
          const overlapX = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
          const overlapY = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
          expect(overlapX && overlapY).toBe(false);
        }
      }
      for (const a of map.slots) for (const b of map.slots) if (a !== b) {
        expect((a.x - b.x) ** 2 + (a.y - b.y) ** 2).toBeGreaterThanOrEqual(90 ** 2);
      }
      expect(pathPosition(map, 0)).toEqual(map.path[0]);
      expect(pathPosition(map, pathLength(map))).toEqual(map.path.at(-1));
    }
  });
});

describe("TD input and replay contract", () => {
  it("places, upgrades twice, sells half the total spend and counts ignored actions", () => {
    const g = createTdGame({ level: tdLevel("2026-10-26", 3) });
    const initial = g.state().coins;
    expect(g.apply({ tick: 0, type: "place", slot: 0, tower: "rollingPin" })).toBe(true);
    expect(g.apply({ tick: 0, type: "place", slot: 0, tower: "oven" })).toBe(false);
    expect(g.apply({ tick: 0, type: "upgrade", slot: 0 })).toBe(true);
    expect(g.apply({ tick: 0, type: "upgrade", slot: 0, branch: "a" })).toBe(true);
    expect(g.apply({ tick: 0, type: "upgrade", slot: 0 })).toBe(false);
    const tower = g.state().towers[0];
    expect(tower.level).toBe(2);
    expect(g.apply({ tick: 0, type: "sell", slot: 0 })).toBe(true);
    expect(g.state().coins).toBe(initial - tower.spent + Math.floor(tower.spent / 2));
    expect(g.state()).toMatchObject({ inputsAccepted: 4, inputsRejected: 2, towers: [] });
  });

  it("rejects malformed live inputs without advancing or spending", () => {
    const g = createTdGame({ level: level() });
    const invalid: unknown[] = [null, [], {}, { tick: 0, type: "place", slot: 0 },
      { tick: 0, type: "callWave", slot: 0 }, { tick: 0, type: "callWave", slot: -1, speed: 2 },
      { tick: 0, type: "sell", slot: 11 }, { tick: 0, type: "place", slot: 0, tower: "toString" },
      ...[-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(tick => ({ tick, type: "sell", slot: 0 }))];
    for (const input of invalid) expect(g.apply(input as TdInput)).toBe(false);
    expect(g.state()).toMatchObject({ tick: 0, inputsRejected: invalid.length, inputsAccepted: 0 });
    expect(g.state().coins).toBe(level().startCoins);
    g.step(10);
    expect(g.apply({ tick: 9, type: "sell", slot: 0 })).toBe(false);
    for (const tick of [9, NaN, Infinity, 10.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => g.step(tick)).toThrow();
  });

  it("rejects unaffordable purchases without creating or upgrading a tower", () => {
    const g = createTdGame({ level: tdLevel("2026-10-26", 8) });
    for (const slot of [0, 1]) expect(g.apply({ tick: 0, type: "place", slot, tower: "oven" })).toBe(true);
    expect(g.apply({ tick: 0, type: "place", slot: 2, tower: "oven" })).toBe(false);
    expect(g.apply({ tick: 0, type: "upgrade", slot: 0 })).toBe(false);
    expect(g.state()).toMatchObject({ coins: tdLevel("2026-10-26", 8).startCoins - 300, inputsAccepted: 2, inputsRejected: 2 });
    expect(g.state().towers.map(t => t.level)).toEqual([0, 0]);
  });

  it("strictly validates the whole replay, including malformed tails", () => {
    expect(() => replayTd({ level: level() }, null as unknown as TdInput[])).toThrow();
    for (const input of [null, {}, { tick: 1, type: "callWave", slot: -1, tower: "oven" }]) {
      expect(() => replayTd({ level: level() }, [input as TdInput])).toThrow();
    }
    expect(() => replayTd({ level: level() }, [{ tick: 2, type: "sell", slot: 0 }], 1)).toThrow();
    expect(() => replayTd({ level: level() }, [
      { tick: 2, type: "sell", slot: 0 }, { tick: g.state().tick, type: "sell", slot: 0 },
    ])).toThrow();
    expect(() => replayTd({ level: level() }, Array(MAX_INPUTS + 1).fill({ tick: 0, type: "sell", slot: 0 }))).toThrow();
    expect(() => replayTd({ level: level() }, Array(MAX_IGNORED_INPUTS + 1).fill({ tick: 0, type: "sell", slot: 0 }))).toThrow();
    expect(replayTd({ level: level() }, [], 0)).toEqual(createTdGame({ level: level() }).state());
    const start: TdInput = { tick: 0, type: "callWave", slot: -1 };
    const end = replayTd({ level: level() }, [start]).tick;
    expect(() => replayTd({ level: level() }, [start, { tick: end, type: "sell", slot: 0 }])).toThrow(/game over/);
    const g = createTdGame({ level: level() });
    for (let i = 0; i < MAX_INPUTS; i++) g.apply({ tick: 0, type: "sell", slot: 0 });
    expect(g.apply({ tick: 0, type: "place", slot: 0, tower: "rollingPin" })).toBe(false);
    expect(g.state().coins).toBe(level().startCoins);
  });

  it("matches replay, detached snapshots, and single vs batched stepping", () => {
    const inputs: TdInput[] = [
      { tick: 0, type: "place", slot: 0, tower: "rollingPin" },
      { tick: 0, type: "place", slot: 1, tower: "rollingPin" },
      { tick: 1, type: "callWave", slot: -1 },
      { tick: 60, type: "place", slot: 2, tower: "rollingPin" },
      { tick: 75, type: "upgrade", slot: 0 },
    ];
    const a = createTdGame({ level: level() }), b = createTdGame({ seed: level().seed });
    const ea: TdEvent[] = [], eb: TdEvent[] = [];
    for (const input of inputs) {
      a.apply(input); ea.push(...a.state().events);
      while (b.state().tick < input.tick) eb.push(...b.step(b.state().tick + 1));
      b.apply(input); eb.push(...b.state().events);
    }
    ea.push(...a.step(1200));
    while (b.state().tick < 1200 && !b.over) eb.push(...b.step(b.state().tick + 1));
    expect(ea).toEqual(eb);
    expect({ ...a.state(), events: [] }).toEqual({ ...b.state(), events: [] });
    expect(a.state()).toEqual(replayTd({ level: level() }, inputs, 1200));
    const snapshot = a.state();
    snapshot.breadTiers.fill(999); snapshot.towers[0].spent = 9999;
    if (snapshot.pests[0]) snapshot.pests[0].hp = -1;
    if (snapshot.projectiles[0]) snapshot.projectiles[0].x = -1;
    snapshot.events.length = 0;
    expect(a.state()).toEqual(replayTd({ level: level() }, inputs, 1200));
  });

  // This is an eight-simulation correctness check, not the replay latency budget.
  it("replays complete passing and failing bot runs on all maps", () => {
    for (const n of [1, 5, 10, 20]) for (const bot of [greedyTd, randomTd]) {
      const l = tdLevel("2026-10-26", n);
      const result = bot(l);
      expect({ ...replayTd({ level: l }, result.inputs), events: [] }).toEqual(result.state);
      expect(result.state.over).toBe(true);
      expect(result.state.tick).toBeLessThanOrEqual(MAX_LEVEL_TICKS);
    }
  }, 60_000);
});

describe("TD combat and waves", () => {
  it("manually starts wave one, auto-starts later waves, awards bounded early bonuses, and forbids spawning-wave spam", () => {
    const auto = createTdGame({ level: level() });
    auto.step(600); expect(auto.state()).toMatchObject({ wave: 0, awaitingStart: true, nextWaveTick: null });
    auto.apply({ tick: 600, type: "callWave", slot: -1 });
    expect(auto.state().events).toContainEqual({ type: "waveStart", tick: 600, wave: 1, targetTier: 5, bonus: 0 });
    const next = 601 + (level().waves[0].pests.length - 1) * level().waves[0].interval + 600;
    auto.step(next - 1); expect(auto.state().wave).toBe(1);
    auto.step(next); expect(auto.state()).toMatchObject({ wave: 2, startedTick: 600, spawning: true });
    const early = createTdGame({ level: level() });
    expect(early.apply({ tick: 0, type: "callWave", slot: -1 })).toBe(true);
    expect(early.state().coins).toBe(level().startCoins);
    expect(early.apply({ tick: 0, type: "callWave", slot: -1 })).toBe(false);
    const lastSpawn = 1 + (level().waves[0].pests.length - 1) * level().waves[0].interval;
    early.step(lastSpawn);
    expect(early.state().nextWaveTick).toBe(lastSpawn + 600);
    expect(early.state().pests.length).toBeGreaterThan(0);
    expect(early.apply({ tick: lastSpawn, type: "callWave", slot: -1 })).toBe(true);
    expect(early.state()).toMatchObject({ wave: 2, coins: level().startCoins + 30 });
    expect(early.apply({ tick: lastSpawn, type: "callWave", slot: -1 })).toBe(false);
  });

  it("carries the most expensive bread back and loses it only at spawn", () => {
    const g = createTdGame({ level: level(), tierCount: 12 });
    const initial = g.state().breadTiers;
    expect(initial[0]).toBe(0); expect(initial.at(-1)).toBe(11);
    g.apply({ tick: 0, type: "callWave", slot: -1 });
    const events = g.step(MAX_LEVEL_TICKS);
    const thefts = events.filter(e => e.type === "pickup");
    expect(thefts.flatMap(e => e.tiers)).toEqual([...initial].reverse());
    expect(new Set(thefts.map(e => e.pest)).size).toBe(10);
    expect(g.state()).toMatchObject({ bread: 0, breadTiers: [], over: true, passed: false });
    expect(events.at(-1)).toMatchObject({ type: "over", reason: "bread" });
    const end = g.state().tick;
    expect(g.step(MAX_LEVEL_TICKS)).toEqual([]);
    expect(g.state().tick).toBe(end);
    expect(g.apply({ tick: end, type: "callWave", slot: -1 })).toBe(false);
  });

  it("applies strongest aura slow and grounds sparrows without stacking", () => {
    const g = createTdGame({ level: tdLevel("2026-10-26", 4) });
    for (const slot of [0, 1]) g.apply({ tick: 0, type: "place", slot, tower: "flourSifter" });
    g.apply({ tick: 0, type: "callWave", slot: -1 });
    let slowed = false, flyingInAura = false;
    for (let tick = 1; tick <= 350; tick++) {
      const before = g.state(); g.step(tick);
      for (const p of g.state().pests) {
        const prev = before.pests.find(q => q.id === p.id);
        if (!prev) continue;
        const auras = before.towers.filter(t => distanceSquared(prev, t) <= towerStats(t.kind).range ** 2);
        const slow = auras.length ? 40 : Math.floor(prev.slowStrength * Math.max(0, prev.slowUntil-tick)/90);
        expect(p.distance - prev.distance).toBe(Math.floor((p.kind === "sparrow" && auras.length ? Math.floor(p.speed * 34 / 56) : p.speed) * (100 - slow) * (prev.onStrip ? 160 : 100) / 10000));
        expect(p.floured).toBe(g.state().towers.some(t => distanceSquared(p, t) <= towerStats(t.kind).range ** 2));
        expect({ x: p.x, y: p.y }).toEqual(pathPosition(g.state().mapData, p.distance));
        if (slow) slowed = true;
        if (auras.length && p.kind === "sparrow") flyingInAura = true;

      }
    }
    expect([slowed, flyingInAura]).toEqual([true, true]);
  });

  it("draws integer projectiles, delays hits, and keeps fired shots alive after selling", () => {
    const g = createTdGame({ level: tdLevel("2026-10-26", 8) });
    g.apply({ tick: 0, type: "place", slot: 0, tower: "oven" });
    g.apply({ tick: 0, type: "callWave", slot: -1 });
    while (!g.state().projectiles.length && g.state().tick < 1000) g.step(g.state().tick+1);
    const shot = g.state().projectiles[0];
    expect(shot.hitTick - shot.bornTick).toBe(towerStats("oven").flight);
    expect(distanceSquared(g.state().pests[0], g.state().towers[0])).toBeGreaterThan(towerStats("rollingPin").range ** 2);
    expect(towerStats("oven").cooldown).toBeGreaterThan(towerStats("rollingPin").cooldown);
    g.apply({ tick: g.state().tick, type: "sell", slot: 0 });
    g.step(shot.hitTick - 1);
    expect(g.state().pests[0].hp).toBe(g.state().pests[0].maxHp);
    const snapshot = g.state();
    snapshot.projectiles[0].targetX = -100;
    expect(g.state().projectiles[0].targetX).toBeGreaterThanOrEqual(0);
    const events = g.step(shot.hitTick);
    expect(events.filter(e => e.type === "hit")).toHaveLength(1);
    expect(events.filter(e => e.type === "hit")[0].damage).toBeGreaterThan(0);
    expect(g.state().coins).toBeGreaterThanOrEqual(240 - 150 + 75);
    const hit = events.find(e => e.type === "hit")!;
    hit.tick = -1;
    expect(g.state().events.every(e => e.tick === shot.hitTick)).toBe(true);
  });

  it("splashes multiple pests, reduces armored damage, and credits each bounty once", () => {
    const splash = createTdGame({ level: tdLevel("2026-10-26", 5) });
    splash.apply({ tick: 0, type: "place", slot: 0, tower: "whisk" });
    splash.apply({ tick: 0, type: "callWave", slot: -1 });
    const events = splash.step(MAX_LEVEL_TICKS);
    const hits = events.filter(e => e.type === "hit");
    expect(hits.some(a => hits.some(b => b !== a && a.projectile === b.projectile && a.pest !== b.pest))).toBe(true);
    const kills = events.filter(e => e.type === "kill");
    expect(new Set(kills.map(e => e.pest)).size).toBe(kills.length);
    expect(splash.state().coins).toBe(tdLevel("2026-10-26", 5).startCoins - 100 + kills.reduce((sum, k) => sum + k.bounty, 0));
    const armor = createTdGame({ level: tdLevel("2026-10-26", 8) });
    armor.apply({ tick: 0, type: "place", slot: 0, tower: "rollingPin" });
    armor.apply({ tick: 0, type: "upgrade", slot: 0 });
    armor.apply({ tick: 0, type: "upgrade", slot: 0, branch: "a" });
    armor.apply({ tick: 0, type: "callWave", slot: -1 });
    const armoredEvents = armor.step(MAX_LEVEL_TICKS);
    const beetles = new Set(armoredEvents.filter(e => e.type === "spawn" && e.kind === "beetle").map(e => (e as Extract<TdEvent, { type: "spawn" }>).pest));
    expect(armoredEvents.some(e => e.type === "hit" && beetles.has(e.pest) && e.damage === towerStats("rollingPin", 2).damage - 36)).toBe(true);
  });

  it("passes only after all five waves clear, and keeps all numeric snapshot fields integer", () => {
    const result = greedyTd(level());
    expect(result.state).toMatchObject({ passed: true, over: true, wave: 5, pests: [], spawning: false });
    expect(result.state.bread).toBeGreaterThan(0);
    const g = createTdGame({ level: level() });
    const integers = (value: unknown): void => {
      if (typeof value === "number") expect(Number.isSafeInteger(value)).toBe(true);
      else if (value && typeof value === "object") Object.values(value).forEach(integers);
    };
    for (const input of result.inputs) { g.apply(input); integers(g.state()); }
    const events = g.step(MAX_LEVEL_TICKS);
    expect(events.at(-1)).toMatchObject({ type: "over", passed: true, reason: "cleared" });
    integers(g.state());
  });
});
