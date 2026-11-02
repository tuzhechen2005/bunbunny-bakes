import { beforeEach, expect, it, vi } from 'vitest';
import type { TdLevel, TowerKind, TdBranch } from '@/lib/td/types';
const fixture = vi.hoisted(() => ({ level: null as TdLevel | null }));
vi.mock('@/lib/td/level', async original => ({ ...await original<object>(), tdLevelFromSeed: () => fixture.level }));
import { createTdGame, pathLength, TD_MAPS, TOWER_KINDS, type TdEvent } from '@/lib/td';

beforeEach(() => {
  fixture.level = { mapData: TD_MAPS[0], unlockedTowers: [...TOWER_KINDS], newlyUnlocked: [], seed: 'combat-fixture', weekKey: '2026-10-26', number: 1, map: 0, startCoins: 10000,
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
  expect(ticks.every(e => e.tower === 0 && e.damage === 28)).toBe(true);
  fixture.level!.waves[0].pests = Array.from({ length: 4 }, () => ({ kind: 'mouse', hp: 10000, armor: 0, speed: 32, bounty: 10 }));
  fixture.level!.waves[0].interval = 1;
  const pierce = setup('oven', 'b');
  const hits = pierce.step(25).filter(e => e.type === 'hit');
  expect(hits).toHaveLength(2);
  expect(new Set(hits.map(e => e.pest)).size).toBe(2);
});
it('a boss carries three tiers and returns them on death, preserving bread conservation', () => {
  fixture.level!.mapData = {name:'bread fixture',path:[{x:100,y:400},{x:300,y:400}],slots:[{x:300,y:300}]};
  fixture.level!.waves = Array.from({length:5},()=>({interval:20,pests:[{kind:'mouse',hp:80,armor:0,speed:1,bounty:0,boss:true}]}));
  fixture.level!.waves[0].pests.push({kind:"mouse",hp:1,armor:0,speed:1,bounty:0});
  fixture.level!.waves[0].interval=100000;
  const game = createTdGame({seed:'combat-fixture',tierCount:10});
  game.apply({tick:0,type:'callWave',slot:-1});
  game.step(3200);
  expect(game.state().pests[0]).toMatchObject({carrying:3,carriedTiers:[7,6,5]});
  game.apply({tick:3200,type:'place',slot:0,tower:'oven'});
  const events: TdEvent[] = [];
  for (let tick=3201;tick<7000 && !game.over;tick++) {
    events.push(...game.step(tick));
    const s=game.state();
    expect(s.breadTiers.length+s.dropped.length+s.pests.reduce((n,p)=>n+p.carrying,0)+s.lost).toBe(10);
  }
  expect(events.find(e=>e.type==='drop' && e.pest===1)).toMatchObject({tiers:[7,6,5]});
});

it('clears five waves with dropped bread still in transit instead of waiting for recovery', () => {
  for (let wave = 0; wave < 5; wave++) fixture.level!.waves[wave].pests = [{
    kind: 'mouse', hp: 80, armor: 0, speed: 400, bounty: 10,
  }];
  const game = createTdGame({ seed: 'combat-fixture' });
  for (let tick = 0; tick < 5; tick++) {
    game.apply({ tick, type: 'callWave', slot: -1 }); game.step(tick + 1);
  }
  const arrival = Math.ceil(pathLength(TD_MAPS[0]) / 400) + 4;
  game.step(arrival + 80);
  expect(game.state().pests[0].carrying).toBe(1);
  game.apply({ tick: arrival + 80, type: 'place', slot: 8, tower: 'oven' });
  game.step(500);
  expect(game.state()).toMatchObject({ over: true, passed: true, wave: 5, pests: [] });
  expect(game.state().dropped.length).toBeGreaterThan(0);
});

it.each([0, 1, 2])('sifter tier %i grounds birds and does not deal chip damage', tier => {
  fixture.level!.waves[0] = { interval: 1, pests: [
    { kind: 'beetle', hp: 10000, armor: 6, speed: 16, bounty: 1 },
    { kind: 'sparrow', hp: 10000, armor: 0, speed: 16, bounty: 1 },
  ] };
  const game = createTdGame({ seed: 'combat-fixture' });
  game.apply({ tick: 0, type: 'place', slot: 0, tower: 'flourSifter' });
  if (tier > 0) game.apply({ tick: 0, type: 'upgrade', slot: 0 });
  if (tier > 1) game.apply({ tick: 0, type: 'upgrade', slot: 0, branch: 'b' });
  game.apply({ tick: 0, type: 'callWave', slot: -1 });
  game.step(400);
  for (const pest of game.state().pests.slice(0, 2)) expect(pest).toMatchObject({ hp: 10000, floured: true, slowed: true, vulnerability: 25 });
  game.apply({ tick: 400, type: 'sell', slot: 0 }); game.step(401);
  expect(game.state().pests.every(p => !p.floured && p.slowed && p.vulnerability === 0)).toBe(true);
});
