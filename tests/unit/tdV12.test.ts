import { beforeEach, expect, it, vi } from 'vitest';
import { createTdGame, replayTd, tdLevel, tdStars, validTdInput, MAX_LEVEL_TICKS, type TdLevel, type TdInput, type TdEvent } from '@/lib/td';
const fixture = vi.hoisted(() => ({level:null as TdLevel|null}));
vi.mock('@/lib/td/level', async original => ({...await original<object>(),tdLevelFromSeed:()=>structuredClone(fixture.level)}));
beforeEach(()=>{
  fixture.level={...tdLevel('2026-10-26',5),startCoins:10000,
    mapData:{name:'v12',path:[{x:100,y:400},{x:1300,y:400}],slots:[{x:200,y:300}]},
    clutter:[{id:0,kind:'flourSack',x:210,y:350,hp:216,maxHp:216,reward:12}],
    waves:Array.from({length:5},()=>({interval:1,pests:[{kind:'mouse',hp:1,speed:1,armor:0,bounty:0}]}))};
});
it.each([1,2,3,4,5])('L%i caps burst damage, telegraphs, ramps phase adds and never spawns on death', n=>{
  fixture.level!.number=n;
  fixture.level!.mapData.path = [{x:100,y:400},{x:13000,y:400}]; // Let escaped adds travel while checking boss timing.
  fixture.level!.waves[0].pests=[{kind:'mouse',hp:90,speed:1,armor:0,bounty:0,boss:true}];
  const game=createTdGame({level:fixture.level!});
  for(const input of [{tick:0,type:'place',slot:0,tower:'rollingPin'},{tick:0,type:'upgrade',slot:0},{tick:0,type:'upgrade',slot:0,branch:'a'},{tick:0,type:'callWave',slot:-1}] as TdInput[]) expect(game.apply(input)).toBe(true);
  const events:TdEvent[]=[];
  let peak=0, phases=0;
  for(let tick=1;tick<3000;tick++) {
    const batch=game.step(tick);events.push(...batch);
    const s=game.state();peak=Math.max(peak,s.pests.length);
    for(const e of batch) if(e.type==='bossPhase') {
      phases++;expect(e.telegraphUntil-e.tick).toBe(48);expect(e.dashUntil-e.telegraphUntil).toBe(24);
      expect(s.pests.find(p=>p.id===e.pest)?.phase).toBe(phases);
    }
    if(batch.some(e=>e.type==='kill' && e.pest===1)) break;
  }
  expect(phases).toBe(2);expect(peak).toBeLessThanOrEqual(16);
  const death=events.find(e=>e.type==='kill'&&e.pest===1)!;
  expect(death).toBeDefined();expect(death.tick).toBeGreaterThanOrEqual(1201);
  expect(events.filter(e=>e.type==='spawn'&&e.wave===1)).toHaveLength(3 + 2 * Math.min(6,n+1));
  expect(events.filter(e=>e.type==='spawn'&&e.tick===death.tick)).toHaveLength(0);
});
it('targets clutter for 3–5 seconds with a base pin, pays exactly once and replays',()=>{
  const inputs:TdInput[]=[{tick:0,type:'place',slot:0,tower:'rollingPin'},{tick:0,type:'target-clutter',clutter:0},{tick:0,type:'callWave',slot:-1}];
  const game=createTdGame({level:fixture.level!});for(const i of inputs) expect(game.apply(i)).toBe(true);
  const before=game.state();const events=game.step(300);
  const cleared=events.find(e=>e.type==='clutterCleared')!;
  expect(cleared).toMatchObject({clutter:0,reward:12});expect(cleared.tick/60).toBeGreaterThanOrEqual(3);expect(cleared.tick/60).toBeLessThanOrEqual(5);
  expect(game.state().coins-before.coins).toBe(12);expect(game.state().targetClutter).toBeNull();
  expect(game.state()).toEqual(replayTd({level:fixture.level!},inputs,300));
  expect(game.apply({tick:300,type:'target-clutter',clutter:0})).toBe(false);
  expect(validTdInput({tick:0,type:'target-clutter',clutter:0,reward:999})).toBe(false);
  const snapshot=game.state();snapshot.clutter[0].hp=999;expect(game.state().clutter[0].hp).toBe(0);
});
it('continues after 300 seconds and gives a clear priority at the safety deadline',()=>{
  fixture.level!.waves=Array.from({length:5},()=>({interval:1,pests:[{kind:'mouse',hp:999999,speed:1,armor:0,bounty:0}]}));
  const game=createTdGame({level:fixture.level!});game.apply({tick:0,type:'callWave',slot:-1});game.step(18000);
  expect(game.over).toBe(false);game.step(MAX_LEVEL_TICKS);expect(game.passed).toBe(true);
});
it.each([[0,0],[1,1],[3,1],[4,2],[7,2],[8,3],[10,3]])('scores %i bread as %i stars only on a clear',(bread,stars)=>{
  expect(tdStars(bread,true)).toBe(stars);expect(tdStars(bread,false)).toBe(0);
});

it('holds still for the full telegraph and then makes a short, deterministic dash',()=>{
  fixture.level!.waves[0]={interval:99999,pests:[{kind:'mouse',hp:300,speed:1,armor:0,bounty:0,boss:true},{kind:'mouse',hp:1,speed:1,armor:0,bounty:0}]};
  const game=createTdGame({level:fixture.level!,itemsAllowed:{bomb:1}});
  game.apply({tick:0,type:'callWave',slot:-1});game.step(361);
  const boss=game.state().pests[0];
  expect(game.apply({tick:361,type:'item',item:'bomb',x:boss.x,y:boss.y})).toBe(true);
  expect(game.state().pests[0].hp).toBe(200);
  game.step(408);expect(game.state().pests[0].distance).toBe(boss.distance);
  game.step(409);expect(game.state().pests[0].distance).toBe(boss.distance+2);
  game.step(433);expect(game.state().pests[0].distance).toBe(boss.distance+24*2+1);
});
it('packs a real swarm under the hard cap and queues the remaining arrivals',()=>{
  fixture.level!.waves[0]={interval:8,maxLivePests:16,pests:Array.from({length:18},()=>({kind:'mouse',hp:42,speed:64,bounty:0,armor:0,tiny:true}))};
  const game=createTdGame({level:fixture.level!});game.apply({tick:0,type:'callWave',slot:-1});game.step(160);
  expect(game.state().pests).toHaveLength(16);expect(game.state().spawning).toBe(true);
  expect(game.state().nextWaveTick).toBeNull();
});

it.each([[1,400,1,1],[5,2160,1.3,1.5],[10,3700,1.5,2],[20,6614,1.3,1.5]])('L%i boss HP preserves early segments and budgets for stronger late spits', (n,previous,min,max)=>{
  const hp=tdLevel('2026-10-26',n).waves[4].pests.at(-1)!.hp;
  expect(hp/previous).toBeGreaterThanOrEqual(min);expect(hp/previous).toBeLessThanOrEqual(max);
});
it('keeps both visible clutter targets separate from tower slots and each other',()=>{
  for(let n=1;n<=100;n++) {
    const level=tdLevel('2026-10-26',n), clutter=level.clutter!;
    expect(clutter).toHaveLength(2);
    for(const c of clutter) {
      expect(c).toMatchObject({hp:216,maxHp:216,reward:12});
      expect(c.x).toBeGreaterThanOrEqual(30);expect(c.x).toBeLessThanOrEqual(1410);
      expect(c.y).toBeGreaterThanOrEqual(30);expect(c.y).toBeLessThanOrEqual(780);
      for(const slot of level.mapData.slots) expect(Math.hypot(c.x-slot.x,c.y-slot.y)).toBeGreaterThanOrEqual(64);
    }
    expect(Math.hypot(clutter[0].x-clutter[1].x,clutter[0].y-clutter[1].y)).toBeGreaterThanOrEqual(48);
  }
});

it.each([[2,44,64,0],[3,46,64,0],[4,48,64,0],[5,320,180,50],[10,500,180,50],[20,693,240,55],[1000,825,240,55]])('L%i spits expose exact stats, deterministic spacing and preserve replay', (n,hp,speed,armor) => {
  fixture.level!.number=n;
  fixture.level!.waves[0]={interval:99999,pests:[{kind:'mouse',hp:300,speed:1,armor:0,bounty:0,boss:true},{kind:'mouse',hp:1,speed:1,armor:0,bounty:0}]};
  const options={level:fixture.level!,itemsAllowed:{bomb:1}};
  const game=createTdGame(options);
  const inputs:TdInput[]=[{tick:0,type:'callWave',slot:-1}];
  game.apply(inputs[0]);game.step(361);
  const boss=game.state().pests.find(p=>p.boss)!;
  inputs.push({tick:361,type:'item',item:'bomb',x:boss.x,y:boss.y});
  expect(game.apply(inputs[1])).toBe(true);
  expect(game.state().events.find(e=>e.type==='bossPhase')).toMatchObject({mice:Math.min(6,n+1)});
  const ids=game.step(362).filter(e=>e.type==='spawn').map(e=>e.pest);
  const mice=game.state().pests.filter(p=>ids.includes(p.id));
  expect(mice).toHaveLength(Math.min(6,n+1));
  for(const [i,p] of mice.entries()) {
    expect(p).toMatchObject({kind:'mouse',tiny:true,wave:1,
      hp,speed,armor,bounty:n<5?0:2});
    expect(p.distance).toBe(boss.distance+(n<5?0:i*12*16)+speed);
  }
  expect(game.state()).toEqual(replayTd(options,inputs,362));
});

it('queues a full spit under the live cap without collapsing its saved spacing', () => {
  fixture.level!.waves[0]={interval:1,maxLivePests:16,pests:[
    {kind:'mouse',hp:300,speed:1,armor:0,bounty:0,boss:true},
    ...Array.from({length:15},()=>({kind:'mouse' as const,hp:401,speed:1,armor:0,bounty:0})),
  ]};
  const game=createTdGame({level:fixture.level!,itemsAllowed:{bomb:1}});
  game.apply({tick:0,type:'callWave',slot:-1});game.step(361);
  const boss=game.state().pests.find(p=>p.boss)!;
  expect(game.state().pests).toHaveLength(16);
  game.apply({tick:361,type:'item',item:'bomb',x:boss.x,y:boss.y});
  expect(game.step(362).some(e=>e.type==='spawn')).toBe(false);
  game.apply({tick:362,type:'place',slot:0,tower:'rollingPin'});
  const arrivals:number[]=[];
  for(let tick=363;tick<2500 && arrivals.length<6;tick++) {
    const events=game.step(tick), state=game.state();
    expect(state.pests.length).toBeLessThanOrEqual(16);
    for(const e of events) if(e.type==='spawn') {
      const p=state.pests.find(p=>p.id===e.pest);
      if(p?.tiny && p.bounty===2) {
        expect(p.wave).toBe(1);
        expect(p.distance).toBe(boss.distance+arrivals.length*12*16+180);
        arrivals.push(p.id);
      }
    }
  }
  expect(arrivals).toHaveLength(6);
});

it('chooses the active branch when a spit offset starts beyond a fork entrance', () => {
  fixture.level!.mapData.features=[{id:0,type:'fork',start:500,end:5000,switchable:true,geometry:[],
    branches:[[{x:131,y:400},{x:412,y:400}],[{x:131,y:400},{x:250,y:500},{x:412,y:400}]]}];
  fixture.level!.waves[0]={interval:99999,pests:[{kind:'mouse',hp:300,speed:1,armor:0,bounty:0,boss:true},{kind:'mouse',hp:1,speed:1,armor:0,bounty:0}]};
  const game=createTdGame({level:fixture.level!,itemsAllowed:{bomb:1}});
  game.apply({tick:0,type:'switch',fork:0});game.apply({tick:0,type:'callWave',slot:-1});game.step(361);
  const boss=game.state().pests.find(p=>p.boss)!;
  expect(boss.forkChoices[0]).toBeUndefined();
  game.apply({tick:361,type:'item',item:'bomb',x:boss.x,y:boss.y});game.step(362);
  const mice=game.state().pests.filter(p=>p.bounty===2);
  expect(mice).toHaveLength(6);
  expect(mice.every(p=>p.forkChoices[0]===1)).toBe(true);
});
