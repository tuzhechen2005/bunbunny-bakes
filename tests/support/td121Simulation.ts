import { tdLevel } from '../../src/lib/td';
import { measureTdSpitRun } from './tdSpitMetrics';
import { mixedTd, responsiveTd, singleTowerTd, tdBotWeeks } from './tdBot';

// Actual runs, legal purchases, no items or injected coins. Attribute permanent
// losses to each phase's next six spawn events, even when the live cap queues them.
const count = Number(process.env.TD_SIM_COUNT ?? 20);
const offset = Number(process.env.TD_SIM_OFFSET ?? 200);
const levels = (process.env.TD_SIM_LEVELS ?? '1,2,3,4,5,10,20').split(',').map(Number);
for (const level of levels) for (const strategy of ['single', 'mixed', 'responsive'] as const) {
  if (strategy === 'responsive' && level < 8) continue;
  const rows = tdBotWeeks(count, offset).map(week => {
    const definition = tdLevel(week, level);
    const run = strategy === 'single' ? singleTowerTd(definition, 'rollingPin') :
      strategy === 'responsive' ? responsiveTd(definition) : mixedTd(definition);
    return measureTdSpitRun(definition,run);
  });
  const median = (a:number[]) => a.length ? a.sort((a,b)=>a-b)[Math.floor(a.length/2)] : null;
  const leaks = rows.flatMap(r=>r.spits);
  console.log(JSON.stringify({level,strategy,n:count,pass:100*rows.filter(r=>r.win).length/count,
    spits:leaks.length,meanLeak:leaks.length ? leaks.reduce((a,b)=>a+b,0)/leaks.length : null,
    medianLeak:median([...leaks]),leakHistogram:Array.from({length:7},(_,i)=>leaks.filter(n=>n===i).length),oneToThree:leaks.filter(n=>n>=1&&n<=3).length,
    bossKills:rows.filter(r=>r.boss!==null).length,bossSeconds:median(rows.flatMap(r=>r.boss===null?[]:[r.boss])),
    encounterSeconds:median(rows.flatMap(r=>r.encounter===null?[]:[r.encounter])),
    engagedSeconds:median(rows.flatMap(r=>r.engaged===null?[]:[r.engaged]))}));
}
