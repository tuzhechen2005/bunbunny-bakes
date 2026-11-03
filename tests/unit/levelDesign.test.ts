import { expect, it } from 'vitest';
import { TD_MAPS, TD_SLOT_RADIUS, tdLevel, pathLength, pathPosition, SUBUNITS } from '@/lib/td';
import { singleTowerTd } from '../support/tdBot';
import { createRunTrack } from '@/lib/run/track';
import { createRunGame, replayRun, ROW_GAP } from '@/lib/run';

it('keeps slot centers clear of path edges, board edges, each other and the stepped-back plate', () => {
  for (const map of TD_MAPS) {
    const plate = pathPosition(map, pathLength(map) - 40 * SUBUNITS);
    expect(Math.min(plate.x,plate.y,1440-plate.x,810-plate.y)).toBeGreaterThanOrEqual(115);
    for(const point of map.path.slice(1)) expect(Math.min(point.x,point.y,1440-point.x,810-point.y)).toBeGreaterThanOrEqual(70);
    for (const slot of map.slots) {
      expect(Math.min(slot.x, slot.y, 1440-slot.x, 810-slot.y)).toBeGreaterThanOrEqual(60 + TD_SLOT_RADIUS);
      expect(Math.hypot(slot.x-plate.x, slot.y-plate.y)).toBeGreaterThanOrEqual(120);
      for (const other of map.slots) if (slot !== other) expect(Math.hypot(slot.x-other.x, slot.y-other.y)).toBeGreaterThanOrEqual(TD_SLOT_RADIUS*3);
      for (let i=1; i<map.path.length; i++) {
        const a=map.path[i-1], b=map.path[i];
        const x=Math.max(Math.min(a.x,b.x),Math.min(Math.max(a.x,b.x),slot.x));
        const y=Math.max(Math.min(a.y,b.y),Math.min(Math.max(a.y,b.y),slot.y));
        expect(Math.hypot(slot.x-x,slot.y-y)).toBeGreaterThanOrEqual(43+60);
      }
    }
  }
});

it('introduces ants, mice, mixed groups, air immunity, then armor in separate levels', () => {
  const expected = [['ant'], ['mouse'], ['ant','mouse'], ['ant','mouse','sparrow'], ['ant','mouse','sparrow','beetle']];
  expected.forEach((kinds,i)=>{
    const level=tdLevel('2026-10-26', i+1);
    expect([...new Set(level.waves.flatMap(w=>w.pests.filter(p=>!p.boss).map(p=>p.kind)))].sort()).toEqual([...kinds].sort());
    expect(level.waves.flatMap(w=>w.pests).filter(p=>p.boss)).toHaveLength(1);
    expect(level.waves[4].pests.at(-1)?.boss).toBe(true);
    expect(level.waves[4].pests.at(-1)!.hp).toBe([400, 520, 640, 1140, 3080][i]);
    expect(level.waves[4].pests.at(-1)!.armor).toBe(i === 0 ? 0 : i < 3 ? 4 : 8);
    expect(level.waves[3].interval).toBeGreaterThanOrEqual(level.waves[2].interval);
    expect(level.waves[3].pests.length).toBeLessThan(level.waves[2].pests.length);
  });
});

it.each(['v5.abcdef0123456789', 'v6.abcdef0123456789', 'v7.abcdef0123456789', 'v8.abcdef0123456789'])('accepts tick-six swipes in realtime, lazy replay and resume: %s', seed => {
  for (const dir of ['L','R'] as const) {
    const live=createRunGame({seed,realtime:true}), lazy=createRunGame({seed});
    live.frame(6); lazy.step(6);
    expect(live.input(6,dir)).toEqual(lazy.input(6,dir));
    const frame=live.frame(21); lazy.step(21);
    expect(frame.player.lane).toBe(dir==='L'?0:2);
    expect(frame.over).toBe(false);
    expect(frame).toEqual(lazy.state());
    const resumed=createRunGame({seed,realtime:true}); resumed.input(6,dir);
    expect(resumed.frame(27)).toEqual(live.frame(27));
    expect(replayRun(seed,[{tick:6,dir}],27).over).toBe(false);
  }
});


it('allows mature exit lane changes, removes free gate rewards, and keeps trucks out of exits', () => {
  let changes = 0, gates = 0;
  for (let seed=0;seed<100;seed++) {
    const track=createRunTrack(`phrase${seed}`);
    for(let index=0;index<20;index++) {
      const chunk=track.next();
      if(chunk.start<240000) continue;
      const mid=chunk.start+2*ROW_GAP, exit=chunk.end;
      const midLane=chunk.objects.find(o=>o.kind==='bread' && o.y===0 && o.z===mid-12000)!.lane;
      const exitLine=chunk.objects.filter(o=>o.kind==='bread' && o.y===0 && o.z===exit-12000);
      expect(exitLine).toHaveLength(1);
      const exitLane = exitLine[0].lane;
      expect(Math.abs(exitLane - midLane)).toBeLessThanOrEqual(1);
      if (exitLane !== midLane) changes++;
      expect(chunk.objects.some(o=>o.kind==='truck' && o.z===exit)).toBe(false);
      const hasVan = chunk.objects.some(o=>o.kind==='van' && o.z===exit);
      const gate = chunk.objects.some(o=>o.lane===exitLane && o.z===exit && ['awning','flour'].includes(o.kind));
      if (gate) gates++;
      expect(chunk.objects.filter(o=>o.kind==='bread' && o.y===0 && o.z>=exit && o.lane===exitLane)).toHaveLength(hasVan || gate ? 0 : 3);
      if (exit >= 2340000) expect(hasVan || gate).toBe(true);
    }
  }
  expect(changes).toBeGreaterThan(0);
  expect(gates).toBeGreaterThan(0);
});

// D7 makes all damage towers independently useful; support alone cannot win.
it('a sifter-only strategy cannot clear without a damage tower', () => {
  for (const n of [1, 10, 20]) expect(singleTowerTd(tdLevel('2026-10-26', n), 'flourSifter').state.passed).toBe(false);
}, 30000);

it('sweeps left to right through three, four and five long vertical runs with rounded turns', () => {
  TD_MAPS.forEach((map, index) => {
    const runs = map.path.slice(1).flatMap((b, i) => {
      const a = map.path[i];
      return a.x === b.x && Math.abs(a.y-b.y) > 400 ? [{ a, b }] : [];
    });
    expect(runs).toHaveLength(index + 3);
    expect(map.path[0].y).toBe(0);
    expect(map.path[0].x).toBeLessThanOrEqual(180);
    runs.forEach(({ a, b }, i) => {
      expect(Math.sign(b.y-a.y)).toBe(i % 2 ? -1 : 1);
      if (i) expect(a.x).toBeGreaterThan(runs[i-1].a.x);
    });
    expect(map.path.filter((b,i) => i && b.x !== map.path[i-1].x && b.y !== map.path[i-1].y).length).toBeGreaterThan(12);
    // Every gap position can reach both neighboring runs with a long-range oven.
    const between = map.slots.filter(s => runs.some((r,i) => i && s.x > runs[i-1].a.x && s.x < r.a.x));
    expect(between.length).toBeGreaterThanOrEqual(9);
    for (const s of between) {
      const right = runs.findIndex(r => r.a.x > s.x);
      expect(Math.max(s.x-runs[right-1].a.x, runs[right].a.x-s.x)).toBeLessThanOrEqual(430);
    }
  });
});

it('uses quantized Euclidean travel through rounded diagonals', async () => {
  const { pathHeading } = await import('@/lib/td');
  const map = { name: 'diagonal fixture', path: [{x:0,y:0},{x:3,y:4}], slots: [] };
  expect(pathLength(map)).toBe(5 * SUBUNITS);
  expect(pathPosition(map, 2.5 * SUBUNITS)).toEqual({x:1,y:2});
  expect(pathPosition(map, 5 * SUBUNITS)).toEqual({x:3,y:4});
  expect(pathHeading(map, SUBUNITS)).toBe(53);
  expect(pathHeading(map, SUBUNITS, true)).toBe(233);
});

it('keeps the stronger swarm milder than boss spits and bounds late-level HP', () => {
  for (const n of [5,10,20,1000]) {
    const swarm=tdLevel('2026-10-26',n).waves[2];
    expect(swarm.pests.length).toBeGreaterThanOrEqual(12);
    expect(swarm.pests.length).toBeLessThanOrEqual(18);
    expect(swarm).toMatchObject({interval:8,maxLivePests:16});
    for (const p of swarm.pests) expect(p).toMatchObject({tiny:true,hp:Math.min(200,60+n*6),speed:66,armor:0});
  }
});
