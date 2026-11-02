import { expect, it } from 'vitest';
import { createRunGame, runSeed } from '@/lib/run';

it('keeps all sprint handovers deterministic and their whole safety buffer free', () => {
 for(let seed=0;seed<100;seed++) {
  const g=createRunGame({seed:runSeed(seed.toString(16),'sprint')});
  const control=g.state().controlTick;
  const events=g.step(control);
  expect(events.filter(e=>e.type==='takeover-warning')).toEqual([{type:'takeover-warning',tick:control-120,controlTick:control}]);
  expect(g.state()).toMatchObject({distance:400000,bread:0,breadPoints:0,over:false});
  while(g.state().distance<464000) {
   const s=g.state();
   expect(s.objects.every(o=>o.z-o.front>0),`seed ${seed}`).toBe(true);
   g.step(s.tick+1);expect(g.state().over).toBe(false);
  }
 }
});
it('keeps sprint pooled and detached snapshots equal through handover', () => {
 const seed=runSeed('abc','sprint'),a=createRunGame({seed}),b=createRunGame({seed,realtime:true});
 for(const tick of [1,400,a.state().controlTick-120,a.state().controlTick,a.state().controlTick+60]) {
  a.step(tick);expect(b.frame(tick)).toEqual(a.state());
 }
});
it('allows practice to be skipped at tick zero', () => {
 const g=createRunGame({seed:runSeed('abc','practice')});g.input(0,'S');
 expect(g.state()).toMatchObject({phase:'running',controlTick:0,distance:0,score:0});
 g.step(1);expect(g.state().distance).toBe(480);
});

it('event-free replay preserves every scoring and control state', () => {
 for(const mode of ['normal','sprint','practice'] as const) {
  const seed=runSeed('abc',mode),a=createRunGame({seed}),b=createRunGame({seed,captureEvents:false});
  for(const tick of [1,200,720,1000,1800]) {
   a.step(tick);b.step(tick);expect(b.state()).toEqual({...a.state(),events:[]});
  }
 }
});
