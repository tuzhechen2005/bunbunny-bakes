import { createTdGame, tdLevel } from '../../src/lib/td';
import { greedyTd, responsiveTd, tdBotWeeks } from './tdBot';
const responsive = process.argv.includes("--responsive");
for (const level of responsive ? [20] : [1,5,10,20]) {
  const rows = tdBotWeeks(20,200).map(week => {
    const definition = tdLevel(week,level), run = (responsive ? responsiveTd : greedyTd)(definition);
    const game = createTdGame({level:definition});
    let input = 0, peak = 0, boss = 0, born = 0, firstHit = 0, dead = 0, phases = 0;
    for (let tick = 0; tick <= run.state.tick; tick++) {
      const events = game.step(tick);
      while (input < run.inputs.length && run.inputs[input].tick === tick) game.apply(run.inputs[input++]);
      for (const event of events) {
        if (event.type === 'bossSpawn') {boss=event.pest;born=tick;}
        if (event.type === 'hit' && event.pest === boss && !firstHit) firstHit=tick;
        if (event.type === 'kill' && event.pest === boss) dead=tick;
        if (event.type === 'bossPhase') phases++;
      }
      if (events.some(e=>e.type==='spawn')) peak=Math.max(peak,game.state().pests.length);
    }
    return {win:run.state.passed,seconds:run.state.tick/60,peak,phases,boss:dead?(dead-born)/60:null,engaged:dead?(dead-firstHit)/60:null};
  });
  const median=(values:number[])=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  console.log(JSON.stringify({strategy:responsive?"responsive":"greedy",level,wins:rows.filter(r=>r.win).length,n:rows.length,medianSeconds:median(rows.map(r=>r.seconds)),peak:Math.max(...rows.map(r=>r.peak)),bossKills:rows.filter(r=>r.boss!==null).length,bossSeconds:median(rows.flatMap(r=>r.boss===null?[]:[r.boss])),engagedSeconds:median(rows.flatMap(r=>r.engaged===null?[]:[r.engaged])),twoPhases:rows.filter(r=>r.phases===2).length}));
}
