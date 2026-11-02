import { beforeEach, expect, it, vi } from 'vitest';
import { BREAD_ROLL_SPEED, createTdGame, MAX_LEVEL_TICKS, START_BREAD, tdLevel, towerStats, validTdInput, type TdEvent, type TdLevel } from '@/lib/td';
import { greedyTd } from '../support/tdBot';

// Bread mechanics use a controlled fixture; canonical balance is tested separately.
const fixture = vi.hoisted(() => ({ level: null as TdLevel | null }));
vi.mock('@/lib/td/level', async original => {
  const actual = await original<typeof import('@/lib/td/level')>();
  return { ...actual, tdLevelFromSeed: (seed: string) => fixture.level
    ? structuredClone(fixture.level) : actual.tdLevelFromSeed(seed) };
});
beforeEach(() => { fixture.level = null; });

it('requires the branch exactly at tier two and rejects extra transport fields', () => {
  const game = createTdGame({ level: tdLevel('2026-10-26', 20) });
  game.apply({ tick: 0, type: 'place', slot: 0, tower: 'rollingPin' });
  expect(game.apply({ tick: 0, type: 'upgrade', slot: 0, branch: 'a' })).toBe(false);
  expect(game.apply({ tick: 0, type: 'upgrade', slot: 0 })).toBe(true);
  expect(game.apply({ tick: 0, type: 'upgrade', slot: 0 })).toBe(false);
  expect(game.apply({ tick: 0, type: 'upgrade', slot: 0, branch: 'b' })).toBe(true);
  expect(game.state().towers[0]).toMatchObject({ tier: 2, level: 2, branch: 'b', target: null, lastAttackTick: null, cooldownProgress: 100 });
  for (const input of [ { tick: 0, type: 'upgrade', slot: 0, branch: 'c' }, { tick: 0, type: 'sell', slot: 0, branch: 'a' }, { tick: 0, type: 'place', slot: 11, tower: 'rollingPin' } ]) expect(validTdInput(input)).toBe(false);
});

it('previews exact next-wave counts and puts exactly one boss in wave five', () => {
  const level = tdLevel('2026-10-26', 1), game = createTdGame({ level });
  const run = greedyTd(level), seen = new Set<number>();
  let inputIndex = 0, bosses = 0;
  for (let tick = 0; tick <= run.state.tick; tick++) {
    const state = game.state(), preview = state.nextWave;
    if (preview) {
      seen.add(preview.index);
      expect(preview.index).toBe(state.wave + 1);
      expect(Object.values(preview.counts).reduce((a, b) => a + b, 0)).toBe(level.waves[state.wave].pests.length);
      expect(preview.counts.boss).toBe(state.wave === 4 ? 1 : 0);
    }
    while (run.inputs[inputIndex]?.tick === tick) expect(game.apply(run.inputs[inputIndex++])).toBe(true);
    bosses += game.step(tick + 1).filter(event => event.type === 'bossSpawn').length;
  }
  expect([...seen]).toEqual([1, 2, 3, 4, 5]);
  expect(bosses).toBe(1);
  expect(game.state().nextWave).toBeNull();
});

it('conserves bread through pickup, death, rollback and recovery, with detached snapshots', () => {
  fixture.level = tdLevel('2026-10-26', 1);
  fixture.level.startCoins = 340;
  fixture.level.mapData.slots = [{ x: 560, y: 350 }, { x: 800, y: 350 }, { x: 350, y: 440 }];
  for (const wave of fixture.level.waves) for (const pest of wave.pests) pest.hp = pest.boss ? 158 : 28;
  const game = createTdGame({ level: tdLevel('2026-10-26', 1) });
  game.apply({ tick: 0, type: 'callWave', slot: -1 });
  const events: TdEvent[] = [];
  let armed = false, disarmed = false;
  for (let tick = 1; tick <= MAX_LEVEL_TICKS && !game.over; tick++) {
    const before = game.state();
    events.push(...game.step(tick));
    const state = game.state();
    expect(state.breadTiers.length + state.dropped.length + state.pests.reduce((n, p) => n + p.carrying, 0) + state.lost).toBe(START_BREAD);
    for (const bread of state.dropped) {
      const old = before.dropped.find(b => b.id === bread.id);
      if (old) expect(bread.distance - old.distance).toBe(BREAD_ROLL_SPEED);
    }
    if (!armed && state.pests.some(p => p.carrying)) {
      expect(state.over).toBe(false); expect(state.bread).toBe(START_BREAD);
      for (const slot of [0, 1, 2]) game.apply({ tick, type: 'place', slot, tower: 'rollingPin' });
      armed = true;
    }
    // After proving recovery, remove the guards to exercise actual loss too.
    if (armed && !disarmed && events.some(e => e.type === 'recover')) {
      for (const slot of [0, 1, 2]) game.apply({ tick, type: 'sell', slot });
      disarmed = true;
    }
    for (const p of state.pests) p.carriedTiers.push(999);
    for (const b of state.dropped) b.tier = 999;
    expect(game.state().pests.every(p => !p.carriedTiers.includes(999))).toBe(true);
  }
  for (const type of ['pickup', 'drop', 'recover', 'lose']) expect(events.some(e => e.type === type)).toBe(true);
  const pickup = events.find(e => e.type === 'pickup')!;
  expect(pickup).toMatchObject({ tiers: [5] });
  for (const kill of events.filter(e => e.type === 'kill')) expect(Number.isInteger(kill.x) && Number.isInteger(kill.y)).toBe(true);
});

it('gives every branch its distinct integer combat stats and makes the bot choose branches', () => {
  expect(towerStats('rollingPin', 2, 'a').strikes).toBe(2);
  expect(towerStats('rollingPin', 2, 'b').knockback).toBeGreaterThan(0);
  expect(towerStats('flourSifter', 2, 'a').slowPercent).toBeGreaterThan(towerStats('flourSifter', 2, 'b').slowPercent);
  expect(towerStats('flourSifter', 2, 'b').range).toBeGreaterThan(towerStats('flourSifter', 2, 'a').range);
  expect(towerStats('whisk', 2, 'a').splash).toBeGreaterThan(towerStats('whisk', 2, 'b').splash);
  expect(towerStats('whisk', 2, 'b').cooldown).toBeLessThan(towerStats('whisk', 2, 'a').cooldown);
  expect(towerStats('oven', 2, 'a').burn).toBeGreaterThan(0);
  expect(towerStats('oven', 2, 'b').pierce).toBe(1);
  expect(greedyTd(tdLevel('2026-10-26', 1)).inputs.some(i => i.type === 'upgrade' && i.branch)).toBe(true);
});

it('an empty pile remains alive while carriers are returning at 80 percent speed', () => {
  const game = createTdGame({ level: tdLevel('2026-10-26', 1) });
  game.apply({ tick: 0, type: 'callWave', slot: -1 });
  let empty = false, returning = false;
  for (let tick = 1; tick < 6000 && !game.over; tick++) {
    const before = game.state();
    game.step(tick);
    const state = game.state();
    if (state.breadTiers.length === 0 && state.bread > 0) { empty = true; expect(game.over).toBe(false); }
    for (const pest of state.pests) {
      const old = before.pests.find(p => p.id === pest.id);
      if (old?.carrying && old.distance > pest.speed) {
        expect(old.distance - pest.distance).toBe(Math.floor(pest.speed * 80 / 100));
        expect(Number.isInteger(pest.heading)).toBe(true);
        expect(pest.heading).toBeGreaterThanOrEqual(0);
        expect(pest.heading).toBeLessThan(360);
        returning = true;
      }
    }
  }
  expect([empty, returning]).toEqual([true, true]);
  expect(game.state()).toMatchObject({ lost: 10, bread: 0, over: true, passed: false });
});
