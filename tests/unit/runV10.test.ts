import { expect, it, vi } from 'vitest';
import type { RunObject } from '@/lib/run';
const fixture = vi.hoisted(() => ({ objects: [] as RunObject[] }));
vi.mock('@/lib/run/track', () => ({ createRunTrack: () => ({ next: () => ({ end: 100_000_000, objects: fixture.objects.map(o => ({...o})) }) }) }));
import { createRunGame, replayRun, runSeed, runSeedVersion } from '@/lib/run';
const loaf = (id: number, lane = 1): RunObject => ({ id, lane: lane as 0|1|2, kind:'bread', z:id*1000, front:0,back:0,height:0 });
it('awards thresholds on the third and sixth loaf and forgives only one miss per chain', () => {
 fixture.objects = Array.from({length:8},(_,i)=>loaf(i+1, i===3||i===7?0:1));
 const g=createRunGame({seed:'combo'});g.step(15);
 expect(g.state()).toMatchObject({bread:6,breadPoints:110,combo:{streak:6,level:3,graceAvailable:false}});
 g.step(18);expect(g.state().combo).toEqual({streak:0,level:1,graceAvailable:true});
});
it('pins start modes in seeds and replays an exact 400m sprint without collection or input effects', () => {
 fixture.objects=[loaf(1),{...loaf(2),kind:'cart',height:5000,front:1000,back:1000}];
 const seed=runSeed('abcd','sprint'),g=createRunGame({seed});
 expect(runSeedVersion(seed)).toBe(10);
 const end=g.state().controlTick; const events=g.input(end-120,'L');g.step(end);
 expect(events).toContainEqual({type:'takeover-warning',tick:end-120,controlTick:end});
 expect(g.state()).toMatchObject({distance:400000,bread:0,over:false,phase:'running',player:{lane:1}});
 expect(replayRun(seed,[{tick:end-120,dir:'L'}],end).score).toBe(400);
});
it('practice runs for 12s without points then starts the same ranked track at zero', () => {
 fixture.objects=[]; const seed=runSeed('abcd','practice');
 const a=createRunGame({seed}),b=createRunGame({seed,realtime:true});
 for(const tick of [1,240,241,480,481,719,720,780]) {a.step(tick);expect(b.frame(tick)).toEqual(a.state());if(tick<=720)expect(a.state().score).toBe(0);}
 expect(a.state().phase).toBe('running');expect(a.state().distance).toBeGreaterThan(0);
});
it('exposes a hit-specific death and resets bread combo on a shield hit', () => {
 fixture.objects=[loaf(1),{...loaf(2),kind:'shield'},{...loaf(10),kind:'cart',height:5000,front:1000,back:1000},{...loaf(20),kind:'awning',height:5000,front:1000,back:1000}];
 const g=createRunGame({seed:'death'});g.step(60);
 expect(g.state().combo.streak).toBe(0);expect(g.state().death).toMatchObject({id:20,kind:'awning',reasonCode:'slide'});
 expect(g.state().events.filter(e=>e.type==='death')).toHaveLength(1);
});

it('records an in-practice skip and replays the ranked distance from that tick', () => {
 fixture.objects=[];
 const seed=runSeed('aabb','practice'),g=createRunGame({seed});
 g.input(200,'S');expect(g.state()).toMatchObject({phase:'running',distance:0,controlTick:200});
 g.step(300);expect(replayRun(seed,[{tick:200,dir:'S'}],300).score).toBe(g.state().score);
});
it('near miss is a once-only successful close clearance and adds no points', () => {
 fixture.objects=[{...loaf(24),kind:'pothole',front:2200,back:2200,height:0}];
 const g=createRunGame({seed:'near'});g.input(23,'U');g.step(80);
 expect(g.state().over).toBe(false);
 expect(g.state().events.filter(e=>e.type==='near-miss')).toHaveLength(1);
 expect(g.state().score).toBe(Math.floor(g.state().distance/1000));
});
