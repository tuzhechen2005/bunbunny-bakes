import { beforeEach, expect, it, vi } from 'vitest';
import type { TdLevel, TdPestSpec, TowerKind, TdBranch } from '@/lib/td/types';
const fixture = vi.hoisted(() => ({ level: null as TdLevel | null }));
vi.mock('@/lib/td/level', async original => ({ ...await original<object>(), tdLevelFromSeed: () => fixture.level }));
import { createTdGame, pathLength, TD_MAPS, type TdEvent } from '@/lib/td';

beforeEach(() => {
  fixture.level = { seed: 'combat-fixture', weekKey: '2026-10-26', number: 1, map: 0, startCoins: 10000,
    waves: Array.from({ length: 5 }, () => ({ interval: 20, pests: [{ kind: 'mouse', hp: 10000, armor: 0, speed: 32, bounty: 10 }] })) };
});
function setup(kind: TowerKind, branch: TdBranch) {
  const game = createTdGame({ seed: 'combat-fixture' });
  game.apply({ tick: 0, type: 'place', slot: 0, tower: kind });
  game.apply({ tick: 0, type: 'upgrade', slot: 0 });
  game.apply({ tick: 0, type: 'upgrade', slot: 0, branch });
  game.apply({ tick: 0, type: 'callWave', slot: -1 });
  return game;
}
it('double hits twice and knockback pushes against travel direction', () => {
  const double = setup('rollingPin', 'a');
  const hits = double.step(150).filter(e => e.type === 'hit');
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.filter(e => e.projectile === hits[0].projectile)).toHaveLength(2);
  const knock = setup('rollingPin', 'b');
  let pushed = false;
  for (let tick = 1; tick < 160; tick++) {
    const before = knock.state().pests[0];
    const events = knock.step(tick);
    if (events.some(e => e.type === 'hit')) {
      expect(knock.state().pests[0].distance).toBeLessThan(before.distance);
      pushed = true;
    }
  }
  expect(pushed).toBe(true);
});
it('burn continues after selling its source and pierce hits nearby additional pests', () => {
  const burn = setup('oven', 'a');
  const first = burn.step(25).find(e => e.type === 'hit');
  expect(first).toBeDefined();
  burn.apply({ tick: 25, type: 'sell', slot: 0 });
  const ticks = burn.step(205).filter(e => e.type === 'hit');
  expect(ticks).toHaveLength(6);
  expect(ticks.every(e => e.tower === 0 && e.damage === 16)).toBe(true);
  fixture.level!.waves[0].pests = Array.from({ length: 4 }, () => ({ kind: 'mouse', hp: 10000, armor: 0, speed: 32, bounty: 10 }));
  fixture.level!.waves[0].interval = 1;
  const pierce = setup('oven', 'b');
  const hits = pierce.step(25).filter(e => e.type === 'hit');
  expect(hits).toHaveLength(3);
  expect(new Set(hits.map(e => e.pest)).size).toBe(3);
});
it('a boss takes three highest tiers, drops the whole stack, and dropped bread ignores passing thieves', () => {
  const spec: TdPestSpec = { kind: 'mouse', hp: 80, armor: 8, speed: 400, bounty: 80, boss: true };
  fixture.level!.waves[0] = { interval: 120, pests: [spec, { ...spec, boss: false, hp: 10000 }] };
  const game = createTdGame({ seed: 'combat-fixture', tierCount: 10 });
  game.apply({ tick: 0, type: 'callWave', slot: -1 });
  const arrival = Math.ceil(pathLength(TD_MAPS[0]) / spec.speed);
  game.step(arrival);
  expect(game.state().pests[0]).toMatchObject({ carrying: 3, carriedTiers: [9, 8, 7], returning: true });
  game.apply({ tick: arrival, type: 'place', slot: 6, tower: 'oven' });
  const events: TdEvent[] = [];
  for (let tick = arrival + 1; tick < 500; tick++) {
    events.push(...game.step(tick));
    const s = game.state();
    expect(s.breadTiers.length + s.dropped.length + s.pests.reduce((n,p) => n+p.carrying,0) + s.lost).toBe(10);
  }
  expect(events.find(e => e.type === 'drop')).toMatchObject({ tiers: [9, 8, 7] });
  expect(events.filter(e => e.type === 'recover')).toHaveLength(3);
  expect(events.filter(e => e.type === 'pickup')).toHaveLength(1);
});

it('clears five waves with dropped bread still in transit instead of waiting for recovery', () => {
  for (let wave = 0; wave < 5; wave++) fixture.level!.waves[wave].pests = [{
    kind: 'mouse', hp: 80, armor: 0, speed: 400, bounty: 10, boss: wave === 4,
  }];
  const game = createTdGame({ seed: 'combat-fixture' });
  for (let tick = 0; tick < 5; tick++) {
    game.apply({ tick, type: 'callWave', slot: -1 });
    game.step(tick + 1);
  }
  game.step(114);
  expect(game.state().pests.find(p => p.boss)?.carrying).toBe(3);
  game.apply({ tick: 114, type: 'place', slot: 6, tower: 'oven' });
  game.step(500);
  expect(game.state()).toMatchObject({ over: true, passed: true, wave: 5, pests: [] });
  expect(game.state().dropped.length).toBeGreaterThan(0);
});
