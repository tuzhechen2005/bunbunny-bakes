import { expect, it } from 'vitest';
import { TD_MAPS, TD_SLOT_RADIUS, tdLevel, pathLength, pathPosition, SUBUNITS } from '@/lib/td';
import { singleTowerTd } from '../support/tdBot';
import { createRunTrack } from '@/lib/run/track';
import { createRunGame, replayRun } from '@/lib/run';

it('keeps slot centers clear of path edges, board edges, each other and the stepped-back plate', () => {
  for (const map of TD_MAPS) {
    const plate = pathPosition(map, pathLength(map) - 40 * SUBUNITS);
    expect(Math.min(plate.x,plate.y,1440-plate.x,810-plate.y)).toBeGreaterThanOrEqual(115);
    for(const point of map.path.slice(1)) expect(Math.min(point.x,point.y,1440-point.x,810-point.y)).toBeGreaterThanOrEqual(103);
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
    expect(level.waves[3].interval).toBeGreaterThan(level.waves[2].interval);
    expect(level.waves[3].pests.length).toBeLessThan(level.waves[2].pests.length);
  });
});

it.each(['v5.abcdef0123456789', 'v6.abcdef0123456789'])('accepts tick-six swipes in realtime, lazy replay and resume: %s', seed => {
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


it('makes mature phrases readable: reward holds its lane and trucks stay out of the exit', () => {
  for (let seed=0;seed<100;seed++) {
    const track=createRunTrack(`phrase${seed}`);
    for(let index=0;index<20;index++) {
      const chunk=track.next();
      if(chunk.start<600000) continue;
      const mid=chunk.start+90000, exit=chunk.end;
      const midLane=chunk.objects.find(o=>o.kind==='bread' && o.z===mid-18000)!.lane;
      const exitLine=chunk.objects.filter(o=>o.kind==='bread' && o.z===exit-18000);
      expect(exitLine.map(o=>o.lane)).toEqual([midLane]);
      expect(chunk.objects.some(o=>o.kind==='truck' && o.z===exit)).toBe(false);
      expect(chunk.objects.filter(o=>o.kind==='bread' && o.z>=exit && o.lane===midLane)).toHaveLength(3);
      if(index%2===0) expect(chunk.objects.some(o=>['truck','van'].includes(o.kind)&&o.z===chunk.start+45000)).toBe(false);
    }
  }
});

it.each(['rollingPin','flourSifter','whisk','oven'] as const)('a single %s strategy cannot solve late speed and armor', kind => {
  for(const n of [10,20]) expect(singleTowerTd(tdLevel('2026-10-26',n),kind).state.passed).toBe(false);
}, 30000);
