import { beforeEach, expect, it, vi } from 'vitest';
import { createTdGame } from '@/lib/td/engine';
import { tdLevelFromSeed } from '@/lib/td/level';
import { towerStats } from '@/lib/td/balance';
import type { TdLevel, TowerKind } from '@/lib/td/types';
vi.mock('@/lib/td/level', () => ({ tdLevelFromSeed: vi.fn() }));
vi.mock('@/lib/td/maps', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/td/maps')>(),
  TD_MAPS: [{ path: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], slots: Array.from({ length: 11 }, (_, i) => ({ x: 100, y: i * 5 })) }],
}));
let fixture: TdLevel;
beforeEach(() => {
  fixture = { seed: 'fixture', weekKey: '2026-10-26', number: 1, map: 0, startCoins: 10000,
    waves: Array.from({ length: 5 }, () => ({ interval: 1, pests: Array.from({ length: 3 }, () => ({ kind: 'mouse', hp: 10000, speed: 16, bounty: 1, armor: 0 })) })) };
  vi.mocked(tdLevelFromSeed).mockImplementation(() => structuredClone(fixture));
});
function game(kind: TowerKind, branch?: 'a' | 'b') {
  const g = createTdGame({ seed: 'fixture' });
  g.apply({ tick: 0, type: 'place', slot: 0, tower: kind });
  if (branch) { g.apply({ tick: 0, type: 'upgrade', slot: 0 }); g.apply({ tick: 0, type: 'upgrade', slot: 0, branch }); }
  g.apply({ tick: 0, type: 'callWave', slot: -1 });
  return g;
}
it('counts actual pin hits and stuns every third hit for 24 ticks', () => {
  const g = game('rollingPin');
  g.step(59);
  expect(g.state().towers[0].hitCount).toBe(3);
  const p = g.state().pests.find(p => p.stunnedUntil > 59)!;
  expect(p.stunnedUntil).toBe(83);
  g.step(82); expect(g.state().pests.find(q => q.id === p.id)!.distance).toBe(p.distance);
  g.step(83); expect(g.state().pests.find(q => q.id === p.id)!.distance).toBeGreaterThan(p.distance);
});
it('double strikes count separately and knockback opposes travel', () => {
  const a = game('rollingPin', 'a'); a.step(7); expect(a.state().towers[0].hitCount).toBe(2);
  const b = game('rollingPin', 'b'); b.step(7); expect(b.state().pests[0].distance).toBe(0);
});
it('whisk leaves detached two-second puddles that slow and expire after selling', () => {
  const g = game('whisk'); g.step(11);
  const puddle = g.state().batterPuddles[0]; expect(puddle.until).toBe(131);
  g.apply({ tick: 11, type: 'sell', slot: 0 });
  g.step(12); expect(g.state().pests.some(p => p.slowed)).toBe(true);
  puddle.until = 9999; g.step(131); expect(g.state().batterPuddles).toEqual([]);
});
it('flour grounds birds, exposes them to whisk and amplifies armor-adjusted damage', () => {
  fixture.waves.forEach(w => w.pests.forEach(p => { p.kind = 'sparrow'; p.speed = 56; p.armor = 3; }));
  const bare = game('whisk'); bare.step(30); expect(bare.state().projectiles).toEqual([]);
  const g = game('whisk'); g.apply({ tick: 0, type: 'place', slot: 1, tower: 'flourSifter' });
  const hits = g.step(11).filter(e => e.type === 'hit');
  expect(hits[0]).toMatchObject({ damage: Math.floor((towerStats('whisk').damage - 3) * 125 / 100) });
  expect(g.state().pests[0]).toMatchObject({ floured: true, slowed: true });
  expect(g.state().pests[0].distance).toBe(11 * Math.floor(Math.floor(56 * 34 / 56) * .6));
  g.apply({ tick: 11, type: 'sell', slot: 1 }); g.step(12);
  expect(g.state().pests[0].floured).toBe(false);
});
it('base oven burns and death spreads to exactly one nearest living pest', () => {
  const g = game('oven'); g.step(25);
  expect(g.state().pests.filter(p => p.burning)).toHaveLength(1);
  const initial = g.state().pests[0].hp; g.step(55); expect(g.state().pests[0].hp).toBeLessThan(initial);
  fixture.waves[0].pests[0].hp = towerStats('oven').damage + 1;
  const dying = game('oven'); dying.step(55);
  expect(dying.state().pests.filter(p => p.burning)).toHaveLength(1);
  expect(dying.state().pests.some(p => p.id === 1)).toBe(false);
});
it('oven b hits exactly two in line and keeps base burn', () => {
  const g = game('oven', 'b'); const hits = g.step(25).filter(e => e.type === 'hit');
  // Oldest target is furthest forward; continuation toward spawn has no victim.
  expect(hits.length).toBeLessThanOrEqual(2);
  expect(towerStats('oven', 2, 'b').pierce).toBe(1);
  expect(towerStats('oven', 2, 'b').burn).toBeGreaterThan(0);
});
it('overlapping sifters use strongest vulnerability and branch a adds exactly 40 percent', () => {
  const g = game('rollingPin');
  for (const slot of [1, 2]) {
    g.apply({ tick: 0, type: 'place', slot, tower: 'flourSifter' });
    g.apply({ tick: 0, type: 'upgrade', slot });
    g.apply({ tick: 0, type: 'upgrade', slot, branch: slot === 1 ? 'a' : 'b' });
  }
  expect(g.step(7).find(e => e.type === 'hit')).toMatchObject({ damage: Math.floor(towerStats('rollingPin').damage * 140 / 100) });
  expect(g.state().pests[0].vulnerability).toBe(40);
});
it('a bird leaving flour before a whisk impact is immune to that impact', () => {
  fixture.waves.forEach(w => w.pests.forEach(p => { p.kind = 'sparrow'; }));
  const g = game('whisk'); g.apply({ tick: 0, type: 'place', slot: 1, tower: 'flourSifter' });
  g.step(1); expect(g.state().projectiles).toHaveLength(1);
  g.apply({ tick: 1, type: 'sell', slot: 1 });
  expect(g.step(11).filter(e => e.type === 'hit')).toEqual([]);
});
it('selling and replacing a pin does not credit its in-flight hit to the new pin', () => {
  const g = game('rollingPin'); g.step(1);
  g.apply({ tick: 1, type: 'sell', slot: 0 });
  g.apply({ tick: 1, type: 'place', slot: 0, tower: 'rollingPin' });
  g.step(7); expect(g.state().towers[0].hitCount).toBe(0);
  g.step(8); expect(g.state().towers[0].hitCount).toBe(1);
});
it('burn ticks continue on refresh and expire after the source is sold', () => {
  const g = game('oven'); g.step(135);
  const p = g.state().pests.find(p => p.burning)!;
  expect(p.burnTick).toBe(145);
  g.apply({ tick: 135, type: 'sell', slot: 0 });
  const events = g.step(315).filter(e => e.type === 'hit' && e.projectile === 0);
  expect(events.length).toBeGreaterThan(0);
  g.step(316); expect(g.state().pests.every(p => !p.burning)).toBe(true);
});
it('knockback refreshes flour membership before later hits and snapshots', () => {
  fixture.waves[0].pests[0].speed = 128;
  const g = game('rollingPin', 'b');
  g.apply({ tick: 0, type: 'place', slot: 1, tower: 'flourSifter' });
  let hit = false;
  for (let tick = 1; tick <= 300; tick++) {
    hit ||= g.step(tick).some(e => e.type === 'hit');
    for (const p of g.state().pests) expect(p.floured).toBe((p.x - 100) ** 2 + (p.y - 5) ** 2 <= 170 ** 2);
  }
  expect(hit).toBe(true);
});
