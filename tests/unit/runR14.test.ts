import { expect, it, vi } from 'vitest';
import type { RunObject, RunObjectKind } from '@/lib/run';
import { runGeometry } from '@/lib/run/geometry';
const fixture = vi.hoisted(() => ({ objects: [] as RunObject[] }));
vi.mock('@/lib/run/track', () => ({ createRunTrack: () => ({ next: () => ({ end: 100_000_000, objects: fixture.objects.map(o => ({...o})) }) }) }));
import { createRunGame, runMultiplier, runDistancePoints } from '@/lib/run/engine';
function obj(kind: RunObjectKind, z: number, id = 1): RunObject {
  return {id, lane:1, kind, z, front:0, back:0, height:0, ...(runGeometry.obstacles as Record<string, object>)[kind]};
}
it('pins distance multiplier thresholds and multiplied distance points', () => {
  expect([499999,500000,1499999,1500000].map(runMultiplier)).toEqual([1,2,2,3]);
  expect([499999,500000,501000,1500000,1501000].map(runDistancePoints)).toEqual([499,1000,1002,4500,4503]);
});
it('requires a correctly timed jump across the whole pothole', () => {
  for (const start of [null,0,23,45]) {
    fixture.objects=[obj('pothole',24000)]; const g=createRunGame({seed:'hole'});
    if(start!==null) g.input(start,'U'); g.step(100);
    expect(g.state().over, String(start)).toBe(start!==23);
  }
});
it('allows only one additional airborne jump with shoes and expires after eight seconds', () => {
  fixture.objects=[obj('double-jump-shoes',480)]; const g=createRunGame({seed:'shoes'});
  g.input(1,'U'); g.input(20,'U'); const y=g.state().player.y;
  expect(g.state().player.progress).toBe(0); expect(y).toBeGreaterThan(0);
  g.input(21,'U'); expect(g.state().player.progress).toBeGreaterThan(0);
  g.step(481); expect(g.state().powerUps.shoesTicks).toBe(0);
});
it('absorbs one obstacle, including its remaining depth, then crashes on the next', () => {
  fixture.objects=[obj('shield',480),obj('cart',8000,2),obj('cart',16000,3)];
  const g=createRunGame({seed:'shield'}); g.step(1); expect(g.state().player.shield).toBe(true);
  g.step(20); expect(g.state().over).toBe(false); expect(g.state().player.shield).toBe(false);
  g.step(60); expect(g.state().over).toBe(true);
});
it('telegraphs trucks for 60 ticks, moves to the target and carries its bread', () => {
  fixture.objects=[{...obj('truck',80000),lane:0,speed:40,targetLane:1}, {...obj('bread',80000,2),lane:0,carrierId:1,speed:40}];
  const g=createRunGame({seed:'truck'}); g.step(1);
  expect(g.state().objects[0]).toMatchObject({lane:0,signalUntil:61,targetLane:1});
  g.step(60); expect(g.state().objects[0].lane).toBe(0);
  g.step(61); expect(g.state().objects.every(o=>o.lane===1)).toBe(true);
});
it('moves wheels at their own speed and permits jumping them', () => {
  fixture.objects=[obj('bread-wheel',24000)];
  const g=createRunGame({seed:'wheel'}); g.step(1); expect(g.state().objects[0].z).toBe(23400);
  g.input(18,'U'); g.step(100); expect(g.state().over).toBe(false);
});
it('supports slide then jump at maximum coffee speed without shoes or shield', () => {
  fixture.objects=[]; const empty=createRunGame({seed:'distance'}); empty.step(2100);
  const d=empty.state().distance;
  fixture.objects=[obj('coffee',d+680),obj('awning',d+22000,2),obj('pothole',d+48000,3)];
  const g=createRunGame({seed:'combo'}); g.step(2100); let slid=false, jumped=false;
  for(let t=2101;t<2200;t++) {
    g.step(t); const s=g.state();
    const awning=s.objects.find(o=>o.kind==='awning');
    if(!slid && awning && awning.z<=s.speed*18) {g.input(t,'D');slid=true;}
    else if(slid && !jumped && s.player.pose!=='slide') {g.input(t,'U');jumped=true;}
    expect(s.over).toBe(false);
  }
  expect(slid && jumped).toBe(true);
});
it('keeps realtime and detached snapshots identical across moving objects and powers', () => {
  fixture.objects=[obj('double-jump-shoes',480),obj('shield',960,2),{...obj('truck',80000,3),lane:0,targetLane:1,speed:40},{...obj('bread-wheel',85000,4),lane:2,speed:120}];
  const live=createRunGame({seed:'same',realtime:true}), lazy=createRunGame({seed:'same'});
  for(let t=0;t<=100;t++) {lazy.step(t);expect(live.frame(t)).toEqual(lazy.state());}
});
it('does not recharge a second jump while airborne above a roof', () => {
  fixture.objects=[obj('double-jump-shoes',480),obj('ramp',9000,2),obj('van',20000,3)];
  const g=createRunGame({seed:'roof-shoes'}); g.input(40,'U');g.input(50,'U');
  expect(g.state().player.progress).toBe(0);g.input(51,'U');
  expect(g.state().player.progress).toBeGreaterThan(0);
});
it('consumes one shield when two distinct hazards overlap, preserving both collision events', () => {
  fixture.objects=[obj('shield',480),obj('cart',8000,2),obj('cart',8000,3)];
  const live=createRunGame({seed:'overlap',realtime:true}), lazy=createRunGame({seed:'overlap'});
  lazy.step(50);const s=live.frame(50);
  expect(s).toEqual(lazy.state());expect(s.over).toBe(true);
  expect(s.events.filter(e=>e.type==='collision').map(e=>e.id)).toEqual([2,3]);
});
it('uses the current distance multiplier in both snapshot APIs and leaves bread unmultiplied', () => {
  fixture.objects=[obj('bread',480)];const g=createRunGame({seed:'score'});
  for (const tick of [1,1000,3000]) {
    g.step(tick);const s=g.state();
    expect(g.frame(tick)).toEqual({...s,events:[]});
    expect(s.multiplier).toBe(runMultiplier(s.distance));
    expect(s.score).toBe(runDistancePoints(s.distance)+10);
  }
  expect(g.state().multiplier).toBe(3);
});
