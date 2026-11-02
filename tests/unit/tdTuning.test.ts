import { expect, it } from "vitest";
import { tdLevel, createTdGame, MAX_LEVEL_TICKS } from "@/lib/td";
import { greedyTd, tdBotWeeks } from "../support/tdBot";
const checkpoints = [0,100].flatMap(offset => [[5,85],[10,55],[20,20]].map(([level,target])=>({offset,level,target})));
it.each(checkpoints)("D9 L$level curve, week offset $offset", ({offset,level,target}) => {
  const runs=tdBotWeeks(20,offset).map(week=>greedyTd(tdLevel(week,level)));
  const rate=runs.filter(r=>r.state.passed).length * 100 / runs.length;
  process.stdout.write(`D9 ${JSON.stringify({offset,level,rate,samples:runs.length})}\n`);
  expect(rate).toBeGreaterThanOrEqual(target-10);expect(rate).toBeLessThanOrEqual(target+10);
  for(const run of runs) expect(run.state.inputsRejected).toBe(0);
},300000);
it('L1 needs only one unupgraded rolling pin across 100 weeks',()=>{
  for(const [index,week] of tdBotWeeks(100).entries()) {
    const game=createTdGame({level:tdLevel(week,1)});
    game.apply({tick:0,type:'place',slot:index%3,tower:'rollingPin'});
    game.apply({tick:0,type:'callWave',slot:-1});game.step(MAX_LEVEL_TICKS);
    expect(game.passed).toBe(true);
  }
},60000);
