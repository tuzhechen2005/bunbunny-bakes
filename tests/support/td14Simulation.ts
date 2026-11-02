import { tdLevel } from '../../src/lib/td';
import { greedyTd, tdBotWeeks } from './tdBot';
import { noviceTd } from './td14Bot';
for (const level of [1,2,3,4]) {
  for (const [policy, bot] of [['novice',noviceTd],['strategy',greedyTd]] as const) {
    const runs = tdBotWeeks(40).map(w => bot(tdLevel(w,level)));
    console.log(JSON.stringify({level,policy,wins:runs.filter(r=>r.state.passed).length,n:runs.length,
      lost:[Math.min(...runs.map(r=>r.state.lost)),Math.max(...runs.map(r=>r.state.lost))]}));
  }
}
