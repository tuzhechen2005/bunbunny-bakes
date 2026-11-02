import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createTdGame, MAX_LEVEL_TICKS, replayTd, tdLevel, towerStats } from '@/lib/td';
import { greedyTd, tdBotWeeks } from '../support/tdBot';
import { noviceTd } from '../support/td14Bot';

it.each([[1,90],[2,80],[3,65],[4,65]])('L%i novice meets %i%% across 40 weeks', (n,target) => {
  const rows = tdBotWeeks(40).map(week => {
    const level = tdLevel(week,n), novice = noviceTd(level), strategy = greedyTd(level);
    expect(novice.state.inputsRejected).toBe(0);
    expect(novice.inputs.filter(i=>i.type==='upgrade').length).toBeLessThanOrEqual(3);
    for (const input of novice.inputs) if (input.type === 'place') expect(level.unlockedTowers).toContain(input.tower);
    if (n === 1) expect(novice.state.lost).toBeLessThanOrEqual(3);
    return {novice:novice.state.passed,strategy:strategy.state.passed};
  });
  const novice = rows.filter(r=>r.novice).length, strategy = rows.filter(r=>r.strategy).length;
  process.stdout.write(`TD14 ${JSON.stringify({level:n,novice,strategy,samples:40})}\n`);
  expect(novice / 40 * 100).toBeGreaterThanOrEqual(target);
  expect(strategy / 40 * 100).toBeGreaterThanOrEqual(target);
},120000);

it('L1 two base pins kill opening pests before bread, earn another purchase by wave 3; one pin loses bread', () => {
  for (const week of tdBotWeeks(40)) {
    const level = tdLevel(week,1);
    expect(level.startCoins).toBe(130);
    const game = createTdGame({level});
    for (const slot of [2,0]) expect(game.apply({tick:0,type:'place',slot,tower:'rollingPin'})).toBe(true);
    game.apply({tick:0,type:'callWave',slot:-1});
    const opening = new Set<number>();
    let earnedByWave3 = false;
    while (!game.over) {
      for (const event of game.step(Math.min(MAX_LEVEL_TICKS,game.state().tick+60))) {
        if (event.type === 'spawn' && event.wave <= 2) opening.add(event.pest);
        if (event.type === 'pickup') expect(opening.has(event.pest),week).toBe(false);
      }
      const state = game.state();
      if (state.wave <= 2 && state.coins >= towerStats('rollingPin').cost) earnedByWave3 = true;
    }
    expect(earnedByWave3,week).toBe(true);
    expect(game.state().lost,week).toBeLessThanOrEqual(3);
    for (const slot of [0,1,2]) {
      const single = createTdGame({level});
      single.apply({tick:0,type:'place',slot,tower:'rollingPin'});
      single.apply({tick:0,type:'callWave',slot:-1});
      single.step(MAX_LEVEL_TICKS);
      expect(single.state().lost,week).toBeGreaterThan(0);
    }
  }
},120000);

it('novice actions replay exactly, including delayed purchases', () => {
  const level = tdLevel('2026-11-02',1), run = noviceTd(level);
  const replay = replayTd({level},run.inputs,run.state.tick);
  expect({...replay,events:[]}).toEqual({...run.state,events:[]});
  const purchases=run.inputs.filter(i=>i.tick>0 && (i.type==='place'||i.type==='upgrade'));
  for (let i=1;i<purchases.length;i++) expect(purchases[i].tick-purchases[i-1].tick).toBeGreaterThanOrEqual(60);
});

it('restores tutorial boss HP and preserves v13 L5+ generation except L5 boss ramp', () => {
  for (const week of tdBotWeeks(40)) {
    expect([1,2,3,4].map(n=>tdLevel(week,n).waves[4].pests.at(-1)!.hp)).toEqual([400,520,640,1140]);
  }
  // Golden generated from the pre-v14 v13 baseline, excluding replay identity and L5 boss HP only.
  const data=[5,6,8,10,18,20,30,1000].flatMap(n=>['2026-01-05','2026-10-26','2026-11-02'].map(week=>{
    const level=tdLevel(week,n);
    return {...level,seed:undefined,waves:level.waves.map(w=>({...w,pests:w.pests.map(p=>n===5&&p.boss?{...p,hp:0}:p)}))};
  }));
  expect(createHash('sha256').update(JSON.stringify(data)).digest('hex')).toBe('da4c05d4fc1ed4adf8e0d0fc3c0f92f221e79a10dd0cd6e264aab1d8b3baa7bc');
});

it('L2 two base pins in each pair keep opening mice from permanently taking bread', () => {
  for (const week of tdBotWeeks(40)) for (const slots of [[0,1],[0,2],[1,2]]) {
    const game = createTdGame({level:tdLevel(week,2)}), opening = new Set<number>();
    for (const slot of slots) game.apply({tick:0,type:'place',slot,tower:'rollingPin'});
    game.apply({tick:0,type:'callWave',slot:-1});
    while (!game.over) {
      for (const event of game.step(Math.min(MAX_LEVEL_TICKS,game.state().tick+60))) {
        if (event.type==='spawn' && event.wave<=2) opening.add(event.pest);
        if (event.type==='lose') expect(opening.has(event.pest),`${week} slots ${slots}`).toBe(false);
      }
    }
  }
},120000);
