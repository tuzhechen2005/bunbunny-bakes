import { beforeEach, expect, it, vi } from 'vitest';
import { createTdGame, tdLevel, TOWER_KINDS, replayTd, type TdLevel, type TdInput } from '@/lib/td';
const fixture = vi.hoisted(() => ({ level: null as TdLevel | null }));
vi.mock('@/lib/td/level', async original => ({ ...await original<object>(), tdLevelFromSeed: () => structuredClone(fixture.level) }));
beforeEach(() => {
  fixture.level = { ...tdLevel('2026-10-26', 20), startCoins: 10000, unlockedTowers:[...TOWER_KINDS],
    mapData:{name:'mechanics',path:[{x:100,y:400},{x:1300,y:400}],slots:[{x:300,y:300}],features:[]},
    waves:Array.from({length:5},()=>({interval:30,pests:Array.from({length:3},()=>({kind:'mouse',hp:10000,speed:160,bounty:1,armor:0}))})) };
});
function start(tower?: typeof TOWER_KINDS[number], branch?: 'a'|'b') {
  const g = createTdGame({seed:fixture.level!.seed,itemsAllowed:{bomb:1,bell:1,slide:1}});
  if (tower) {
    expect(g.apply({tick:0,type:'place',slot:0,tower})).toBe(true);
    if (branch) { g.apply({tick:0,type:'upgrade',slot:0}); g.apply({tick:0,type:'upgrade',slot:0,branch}); }
  }
  g.apply({tick:0,type:'callWave',slot:-1}); return g;
}
it('applies strip and jam integer speeds, portal skips and tunnel targeting immunity', () => {
  fixture.level!.mapData.features = [
    {id:0,type:'strip',start:0,end:1600,geometry:[]},
    {id:1,type:'jam',start:1600,end:3200,geometry:[]},
    {id:2,type:'portal',start:4000,end:8000,geometry:[]},
    {id:3,type:'tunnel',start:8000,end:10000,geometry:[]},
  ];
  const g=start('oven'); let strip=false,jam=false,portal=false,tunnel=false;
  for(let tick=1;tick<80;tick++) {
    const prev=g.state().pests[0]; g.step(tick); const p=g.state().pests[0];
    if (!p || !prev) continue;
    if(prev.onStrip && prev.distance+256<1600) {expect(p.distance-prev.distance).toBe(256);strip=true;}
    if(prev.onJam && prev.distance+96<3200) {expect(p.distance-prev.distance).toBe(96);jam=true;}
    if(prev.distance<4000 && p.distance>=8000) portal=true;
    if(p.inTunnel) {expect(g.state().events.some(e=>e.type==='shot' && e.target===p.id)).toBe(false);tunnel=true;}
  }
  expect([strip,jam,portal,tunnel]).toEqual([true,true,true,true]);
});
it('switches only future fork entries and replays branch choices at any step size', () => {
  fixture.level!.mapData.features=[{id:0,type:'fork',start:1600,end:6400,switchable:true,geometry:[],branches:[[{x:200,y:400},{x:350,y:300},{x:500,y:400}],[{x:200,y:400},{x:350,y:500},{x:500,y:400}]]}];
  const inputs:TdInput[]=[{tick:0,type:'callWave',slot:-1},{tick:15,type:'switch',fork:0}];
  const g=createTdGame({seed:fixture.level!.seed}); for(const i of inputs)g.apply(i);g.step(45);
  expect(g.state().pests[0].forkChoices[0]).toBe(0);expect(g.state().pests[1].forkChoices[0]).toBe(1);
  expect(g.state()).toEqual(replayTd({seed:fixture.level!.seed},inputs,45));
  const fine=createTdGame({seed:fixture.level!.seed});fine.apply(inputs[0]);for(let t=1;t<=45;t++){fine.step(t);if(t===15)fine.apply(inputs[1]);}
  expect({...fine.state(),events:[]}).toEqual({...g.state(),events:[]});
});
it('bell lasts 180 ticks, bomb damages at a point, slide slips each pest once', () => {
  const g=start();g.step(10);const before=g.state().pests[0];
  expect(g.apply({tick:10,type:'item',item:'bell'})).toBe(true);expect(g.state().pests[0].frozenUntil).toBe(190);g.step(189);expect(g.state().pests[0].distance).toBe(before.distance);
  g.step(190);expect(g.state().pests[0].distance).toBeGreaterThan(before.distance);
  const p=g.state().pests[0];g.apply({tick:190,type:'item',item:'bomb',x:p.x,y:p.y});expect(g.state().pests[0].hp).toBe(p.hp-400);
  g.apply({tick:190,type:'item',item:'slide',position:p.distance+500});g.step(194);expect(g.state().pests[0].slipped).toHaveLength(1);
  g.step(220);expect(g.state().pests[0].slipped).toHaveLength(1);
});
it.each(['freezer','pipingBag','caramelTorch'] as const)('%s base and branches have active, deterministic mechanics', kind => {
  for(const branch of [undefined,'a','b'] as const) {
    const g=start(kind,branch);g.step(60);const state=g.state();
    expect(state.towers[0].lastAttackTick).not.toBeNull();
    if(kind==='freezer')expect(state.pests.some(p=>p.frozenUntil>0)).toBe(true);
    if(kind==='pipingBag')expect(state.creamLines.length).toBeGreaterThan(0);
    if(kind==='caramelTorch')expect(state.pests.some(p=>p.hp<p.maxHp)).toBe(true);
  }
});
it('sifter leaves a linearly decaying 90-tick slow after removal', () => {
  const g=start('flourSifter');g.step(10);g.apply({tick:10,type:'sell',slot:0});
  g.step(55);let p=g.state().pests[0];expect(p.slowUntil).toBe(100);
  const before=p.distance;g.step(56);p=g.state().pests[0];expect(p.distance-before).toBe(Math.floor(160*(100-Math.floor(40*44/90))/100));
  g.step(100);expect(g.state().pests[0].slowed).toBe(false);
});
it('random forks use the seeded stream and retain choices on return', () => {
  fixture.level!.mapData.features=[{id:0,type:'fork',start:1600,end:6400,geometry:[],branches:[[{x:200,y:400},{x:350,y:300},{x:500,y:400}],[{x:200,y:400},{x:350,y:500},{x:500,y:400}]]}];
  fixture.level!.waves[0].pests=Array.from({length:20},()=>({kind:'mouse',hp:10000,speed:160,bounty:1,armor:0}));fixture.level!.waves[0].interval=1;
  const a=start(),b=start();a.step(60);for(let t=1;t<=60;t++)b.step(t);
  expect({...a.state(),events:[]}).toEqual({...b.state(),events:[]});
  expect(new Set(a.state().pests.map(p=>p.forkChoices[0])).size).toBe(2);
  const choices=a.state().pests.map(p=>p.forkChoices[0]);a.step(125);
  for(const p of a.state().pests.filter(p=>p.id<=20))expect(p.forkChoices[0]).toBe(choices[p.id-1]);
});

it('portals skip cream lines in the bypassed path stretch', () => {
  fixture.level!.mapData.features=[{id:0,type:'portal',start:4000,end:8000,geometry:[]}];
  const g=start();
  expect(g.apply({tick:0,type:'item',item:'slide',position:6000})).toBe(true);
  g.step(25);
  expect(g.state().pests[0]).toMatchObject({distance:8000,slipped:[]});
});
it('a cream line before a portal interrupts entry during a long movement step', () => {
  fixture.level!.mapData.features=[{id:0,type:'portal',start:4000,end:8000,geometry:[]}];
  fixture.level!.waves[0].pests[0].speed=5000;
  const g=start();g.apply({tick:0,type:'item',item:'slide',position:3900});g.step(1);
  expect(g.state().pests[0]).toMatchObject({distance:2080,slipped:[1]});
});
