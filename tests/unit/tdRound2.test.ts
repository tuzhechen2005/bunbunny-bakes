import { expect, it } from 'vitest';
import { BREAD_ROLL_SPEED, createTdGame, MAX_LEVEL_TICKS, START_BREAD, tdLevel, towerStats, validTdInput, type TdEvent } from '@/lib/td';
import { greedyTd } from '../support/tdBot';

it('requires the branch exactly at tier two and rejects extra transport fields', () => {
  const game = createTdGame({ level: tdLevel('2026-10-26', 20) });
  game.apply({ tick: 0, type: 'place', slot: 0, tower: 'rollingPin' });
  expect(game.apply({ tick: 0, type: 'upgrade', slot: 0, branch: 'a' })).toBe(false);
  expect(game.apply({ tick: 0, type: 'upgrade', slot: 0 })).toBe(true);
  expect(game.apply({ tick: 0, type: 'upgrade', slot: 0 })).toBe(false);
  expect(game.apply({ tick: 0, type: 'upgrade', slot: 0, branch: 'b' })).toBe(true);
  expect(game.state().towers[0]).toMatchObject({ tier: 2, level: 2, branch: 'b', target: null, lastAttackTick: null, cooldownProgress: 100 });
  for (const input of [ { tick: 0, type: 'upgrade', slot: 0, branch: 'c' }, { tick: 0, type: 'sell', slot: 0, branch: 'a' }, { tick: 0, type: 'place', slot: 11, tower: 'oven' } ]) expect(validTdInput(input)).toBe(false);
});

it('previews exact next-wave counts and puts exactly one boss in wave five', () => {
  const level = tdLevel('2026-10-26', 1), game = createTdGame({ level });
  game.apply({ tick: 0, type: 'place', slot: 0, tower: 'oven' });
  game.apply({ tick: 0, type: 'place', slot: 1, tower: 'whisk' });
  for (let wave = 0; wave < 5; wave++) {
    const preview = game.state().nextWave!;
    expect(preview.index).toBe(wave + 1);
    expect(Object.values(preview.counts).reduce((a, b) => a + b, 0)).toBe(level.waves[wave].pests.length);
    expect(preview.counts.boss).toBe(wave === 4 ? 1 : 0);
    game.apply({ tick: game.state().tick, type: 'callWave', slot: -1 });
    const events = game.step(game.state().tick + 1 + (level.waves[wave].pests.length - 1) * level.waves[wave].interval);
    if (wave === 4) {
      expect(events.filter(e => e.type === 'bossSpawn')).toHaveLength(1);
      expect(game.state().pests.find(p => p.boss)).toMatchObject({ kind: 'mouse', armor: 4, speed: 20, carrying: 0 });
    }
  }
  expect(game.state().nextWave).toBeNull();
});

it('conserves bread through pickup, death, rollback and recovery, with detached snapshots', () => {
  const game = createTdGame({ level: tdLevel('2026-10-26', 1) });
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
      for (const slot of [9, 5]) game.apply({ tick, type: 'place', slot, tower: 'oven' });
      armed = true;
    }
    // After proving recovery, remove the guards to exercise actual loss too.
    if (armed && !disarmed && events.some(e => e.type === 'recover')) {
      for (const slot of [9, 5]) game.apply({ tick, type: 'sell', slot });
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
  expect(towerStats('oven', 2, 'b').pierce).toBe(2);
  expect(greedyTd(tdLevel('2026-10-26', 1)).inputs.some(i => i.type === 'upgrade' && i.branch)).toBe(true);
});

it('an empty pile remains alive while carriers are returning at 80 percent speed', () => {
  const game = createTdGame({ level: tdLevel('2026-10-26', 1) });
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
