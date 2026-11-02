import { expect, it } from "vitest";
import { createGrabGame, breadPoints, grabLevelRules, reelSpeed, replayGrab, MAX_RUN_TICKS } from "@/lib/grab";
import { greedyGrab } from "../support/grabBot";
const tiers = Array.from({ length: 8 }, (_, i) => ({ id: `${i}` }));

it("guarantees both order ingredients immediately, even duplicate kinds", () => {
  let duplicates = 0;
  for (let seed = 0; seed < 100; seed++) {
    const game = createGrabGame({ seed: `orders${seed}`, tiers });
    const state = game.state();
    expect(state.items.filter(i => i.x < 180 || i.x > 540).length).toBeLessThanOrEqual(6);
    const pool = state.items.filter(i => i.kind === "bread").map(i => i.tier);
    expect(state.order.required).toHaveLength(2);
    expect(state.order.reward).toBe(2 * breadPoints("S", 240));
    if (state.order.required[0] === state.order.required[1]) duplicates++;
    for (const tier of state.order.required) { expect(pool).toContain(tier); pool.splice(pool.indexOf(tier), 1); }
    state.order.remaining.length = 0;
    expect(game.state().order.remaining).toHaveLength(2);
  }
  expect(duplicates).toBeGreaterThan(0);
});

it("locks exact points at contact, banks only on return, rolls orders and levels deterministically", () => {
  let contacts = 0, orders = 0, transitions = 0, mice = 0, gold = 0, chainBonuses = 0;
  for (let i = 0; i < 12; i++) {
    const seed = `v6-contract${i}`, run = greedyGrab(seed, tiers);
    const game = createGrabGame({ seed, tiers });
    const launches = new Set(run.launches);
    let pending = 0, banked = 0, expectedChain = 0;
    while (!game.over) {
      const before = game.state();
      if (launches.has(before.tick)) game.launch(before.tick);
      for (const e of game.step(before.tick + 1)) {
        if (e.type === "contact") {
          contacts++;
          expectedChain = e.stage === "perfect" ? Math.min(3, expectedChain + 1) : 0;
          expect(e.chain).toBe(expectedChain);
          expect(game.score).toBe(banked);
          expect(game.state().pendingResult).toMatchObject({ item: e.item, points: e.points, stage: e.stage });
          const held = game.state().claw.held!;
          expect(e.stage).toBe(held.stage);
          expect(e.multiplierPercent).toBe(100 + Math.max(0, e.chain - 1) * 10);
          if (e.chain > 1) chainBonuses++;
          if (held.mouse) mice++;
          if (held.golden) gold++;
          const base = held.kind === "bread" ? breadPoints(held.size, held.age) * (held.mouse ? 2 : held.golden ? 3 : 1) : held.kind === "clock" ? 0 : 20;
          expect(e.points).toBe(Math.floor(base * e.multiplierPercent / 100));
          pending = e.points;
        }
        if (e.type === "explode") expectedChain = 0;
        if (e.type === "score") { expect(e.points).toBe(pending); banked += e.points; }
        if (e.type === "order") {
          orders++; banked += e.reward;
          expect(e.order.remaining).toHaveLength(2);
          expect(e.order.id).toBe(e.completed + 1);
          e.order.remaining.length = 0;
          expect(game.state().order.remaining).toHaveLength(2);
        }
        if (e.type === "level") {
          transitions++;
          expect(game.state().levelScore).toBe(0);
          expect(e.target).toBe(grabLevelRules(e.level).target);
        }
      }
      const after = game.state();
      if (before.claw.phase === "extending" && after.claw.phase === "reeling" && !after.claw.held) expectedChain = 0;
      expect(after.perfectChain).toBe(expectedChain);
      expect(game.score).toBe(banked);
    }
    expect(replayGrab(seed, tiers, run.launches)).toMatchObject({ score: banked, level: run.level, completedOrders: run.completedOrders });
    expect(game.state().tick).toBeLessThanOrEqual(MAX_RUN_TICKS);
  }
  for (const [name, count] of Object.entries({ contacts, orders, transitions, mice, gold, chainBonuses })) expect(count, name).toBeGreaterThan(0);
}, 30_000);

it("bounds flour return, escalates levels, and trades golden points for comparable travel value", () => {
  expect(Math.ceil(1140 / reelSpeed(8)) / 60).toBeLessThanOrEqual(4);
  for (const weight of [0, 1, 2, 3]) expect(reelSpeed(weight)).toBeGreaterThanOrEqual((17 - 4 * weight) / .8);
  for (let level = 2; level < 9; level++) {
    expect(grabLevelRules(level).target).toBeGreaterThan(grabLevelRules(level - 1).target);
    expect(grabLevelRules(level).duration).toBeLessThanOrEqual(grabLevelRules(level - 1).duration);
  }
  expect(grabLevelRules(2).mice).toBe(false);
  expect(grabLevelRules(3).mice).toBe(true);
  // Same distance/stage: 3x medium bread points cost 3.69x the travel time.
  const relativeValue = 3 * (1 / 14 + 1 / reelSpeed(2)) / (1 / 14 + 1 / reelSpeed(12));
  expect(relativeValue).toBeGreaterThan(.75);
  expect(relativeValue).toBeLessThan(1.1);
});
