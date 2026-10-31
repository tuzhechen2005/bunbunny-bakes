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
  game.apply({ tick: arrival, type: 'place', slot: 10, tower: 'oven' });
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
  const arrival = Math.ceil(pathLength(TD_MAPS[0]) / 400) + 4;
  game.step(arrival + 80);
  expect(game.state().pests.find(p => p.boss)?.carrying).toBe(3);
  game.apply({ tick: arrival + 80, type: 'place', slot: 8, tower: 'oven' });
  game.step(500);
  expect(game.state()).toMatchObject({ over: true, passed: true, wave: 5, pests: [] });
  expect(game.state().dropped.length).toBeGreaterThan(0);
});

it('sifter chips at exact tier DPS and coating lasts one second after sale', () => {
  const game = setup('flourSifter', 'a');
  // Stationary fixture starts within the slot-0 aura.
  const pest = fixture.level!.waves[0].pests[0];
  pest.speed = 0;
  game.step(60);
  expect(game.state().pests[0]).toMatchObject({ hp: 9984, slowed: true });
  game.apply({ tick: 60, type: 'sell', slot: 0 });
  game.step(120);
  expect(game.state().pests[0]).toMatchObject({ hp: 9968, slowed: true });
  game.step(121);
  expect(game.state().pests[0].slowed).toBe(false);
});

it.each([0, 1, 2])('sifter tier %i deals 6/10/16 DPS through armor and never hits sparrows', tier => {
  fixture.level!.waves[0] = { interval: 1, pests: [
    { kind: 'beetle', hp: 10000, armor: 6, speed: 0, bounty: 1 },
    { kind: 'sparrow', hp: 10000, armor: 0, speed: 0, bounty: 1 },
  ] };
  const game = createTdGame({ seed: 'combat-fixture' });
  game.apply({ tick: 0, type: 'place', slot: 0, tower: 'flourSifter' });
  if (tier > 0) game.apply({ tick: 0, type: 'upgrade', slot: 0 });
  if (tier > 1) game.apply({ tick: 0, type: 'upgrade', slot: 0, branch: 'b' });
  game.apply({ tick: 0, type: 'callWave', slot: -1 });
  game.step(600);
  const before = game.state().pests;
  game.step(660);
  const after = game.state().pests;
  expect(before[0].hp - after[0].hp).toBe([6, 10, 16][tier]);
  expect(after[1]).toMatchObject({ hp: 10000, slowed: false });
});

it('branch a coating expires 60 ticks after the last tick inside its aura', () => {
  fixture.level!.waves[0].pests[0].speed = 400;
  const game = setup('flourSifter', 'a');
  let lastInside = 0, outsideSlowed = false, expired = false;
  for (let tick = 1; tick <= 150; tick++) {
    const previous = game.state().pests[0];
    if (previous && (previous.x - TD_MAPS[0].slots[0].x) ** 2 + (previous.y - TD_MAPS[0].slots[0].y) ** 2 <= 200 ** 2) lastInside = tick;
    game.step(tick);
    if (previous && lastInside && tick > lastInside) {
      expect(game.state().pests[0].slowed).toBe(tick <= lastInside + 60);
      outsideSlowed ||= tick <= lastInside + 60;
      expired ||= tick > lastInside + 60;
    }
  }
  expect([outsideSlowed, expired]).toEqual([true, true]);
});

it.each([0, 1])('overlapping tier-0 and tier-%i sifters apply only the strongest chip rate', tier => {
  fixture.level!.waves[0].pests[0].speed = 16;
  const game = createTdGame({ seed: 'combat-fixture' });
  for (const slot of [0, 1]) game.apply({ tick: 0, type: 'place', slot, tower: 'flourSifter' });
  if (tier) game.apply({ tick: 0, type: 'upgrade', slot: 1 });
  game.apply({ tick: 0, type: 'callWave', slot: -1 });
  let tick = 0;
  while ((game.state().pests[0]?.x ?? 0) < 260 && tick < 1000) game.step(++tick);
  const before = game.state().pests[0];
  expect(before.x).toBe(260);
  game.step(tick + 60);
  expect(before.hp - game.state().pests[0].hp).toBe(tier ? 10 : 6);
});
