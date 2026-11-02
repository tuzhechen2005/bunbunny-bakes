import { expect, it } from 'vitest';
import { createTdGame, tdLevel, pathLength, replayTd, countItemUses } from '@/lib/td';

it('unlocks by level and supplies distinct, bounded maps and slot counts', () => {
  for (let n = 1; n <= 100; n++) {
    const level = tdLevel('2026-10-26', n);
    expect(level.mapData.slots).toHaveLength(Math.min(11, 3 + Math.floor((n - 1) / 2)));
    expect(level.unlockedTowers.length).toBe([1,3,5,8,11,14,18].filter(x => x <= n).length);
    expect(level.newlyUnlocked).toHaveLength([1,3,5,8,11,14,18].includes(n) ? 1 : 0);
    expect(pathLength(level.mapData)).toBeGreaterThan(0);
    for (const p of [...level.mapData.path, ...level.mapData.slots]) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(1440);
      expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThanOrEqual(810);
    }
    expect(tdLevel('2026-10-26', n)).toEqual(level);
  }
}, 30000);
it('rejects locked towers, missing slots and unauthorized or repeated items', () => {
  const game = createTdGame({ level: tdLevel('2026-10-26', 1) });
  expect(game.apply({ tick: 0, type: 'place', slot: 0, tower: 'oven' })).toBe(false);
  expect(game.apply({ tick: 0, type: 'place', slot: 3, tower: 'rollingPin' })).toBe(false);
  expect(game.apply({ tick: 0, type: 'item', item: 'bell' })).toBe(false);
  const level = tdLevel('2026-10-26', 10);
  const inputs = [{ tick: 0, type: 'item', item: 'bell' }, { tick: 0, type: 'callWave', slot: -1 }] as const;
  const allowed = createTdGame({ level, itemsAllowed: { bell: 1 } });
  expect(allowed.apply(inputs[0])).toBe(true);
  expect(allowed.apply(inputs[0])).toBe(false);
  expect(countItemUses(inputs)).toEqual({ bomb: 0, bell: 1, slide: 0 });
  expect(replayTd({ level, itemsAllowed: { bell: 1 } }, inputs, 1).pests[0].distance).toBe(0);
});
it('stages exactly one new tower, item or path idea on any level', () => {
  let previous = new Set<string>();
  for(let n=1;n<=20;n++) {
    const level=tdLevel('2026-10-26',n);
    const ideas=new Set([...level.unlockedTowers,...(level.mapData.features??[]).flatMap(f=>f.switchable?[f.type,'switch']:[f.type]),...(['bomb','bell','slide'].filter((_,i)=>n>=[2,6,10][i]))]);
    expect([...ideas].filter(i=>!previous.has(i)).length).toBeLessThanOrEqual(1);previous=ideas;
  }
});
it('regenerates map data from seed and refuses item logs that cannot be charged', () => {
  const level=tdLevel('2026-10-26',20), pristine=tdLevel('2026-10-26',20);
  level.mapData={name:'tampered',path:[],slots:[]}; level.unlockedTowers=[];
  expect(createTdGame({level}).state().mapData).toEqual(pristine.mapData);
  expect(()=>replayTd({level},[{tick:0,type:'item',item:'bell'}],0)).toThrow(/item/);
  expect(()=>replayTd({level,itemsAllowed:{bell:1}},[{tick:0,type:'item',item:'bell'},{tick:0,type:'item',item:'bell'}],0)).toThrow(/item/);
  expect(countItemUses([])).toEqual({bomb:0,bell:0,slide:0});
  const other=tdLevel('2026-11-02',20);
  expect(other.mapData).not.toEqual(pristine.mapData);
  expect(tdLevel('2026-11-02',1).unlockedTowers).toEqual(['rollingPin']);
});
it('keeps authored and generated slots off both fork lanes with useful coverage', () => {
  for (let n=1;n<=100;n++) {
    const map=tdLevel('2026-11-02',n).mapData;
    const segmentDistance=(p:{x:number;y:number},a:{x:number;y:number},b:{x:number;y:number})=>{
      const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
      return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
    };
    for(const slot of map.slots) {
      const nearest=Math.min(...map.path.slice(1).map((b,i)=>segmentDistance(slot,map.path[i],b)));
      expect(nearest).toBeGreaterThanOrEqual(80);expect(nearest).toBeLessThanOrEqual(165);
      for(const other of map.slots) if(other!==slot) expect(Math.hypot(slot.x-other.x,slot.y-other.y)).toBeGreaterThanOrEqual(126);
      for(const f of map.features??[]) for(const branch of f.branches??[]) {
        for(let i=1;i<branch.length;i++) expect(segmentDistance(slot,branch[i-1],branch[i])).toBeGreaterThanOrEqual(65);
      }
    }
    for(const f of map.features??[]) {
      expect(f.start).toBeLessThan(f.end);expect(f.end).toBeLessThanOrEqual(pathLength(map));
      for(const p of [...f.geometry,...(f.branches??[]).flat()]) {
        expect(p.x>=0&&p.x<=1440&&p.y>=0&&p.y<=810).toBe(true);
      }
    }
  }
}, 30000);
it('bot logs only unlocked towers and authorized items, with replayable switch decisions', async () => {
  const {greedyTd}=await import('../support/tdBot');
  const level=tdLevel('2026-10-26',10),itemsAllowed={bomb:1,bell:1,slide:1};
  const result=greedyTd(level,itemsAllowed);
  expect(result.state.inputsRejected).toBe(0);
  expect(result.inputs.some(i=>i.type==='item')).toBe(true);
  for(const input of result.inputs) if(input.type==='place') expect(level.unlockedTowers).toContain(input.tower);
  expect(countItemUses(result.inputs)).toEqual(result.state.itemsUsed);
  expect({...replayTd({level,itemsAllowed},result.inputs),events:[]}).toEqual(result.state);
},60000);
