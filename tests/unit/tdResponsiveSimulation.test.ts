import { expect, it } from 'vitest';
import { replayTd, tdLevel } from '@/lib/td';
import { responsiveTd } from '../support/tdBot';

it('replays the boss response build using only earned coins and logged purchases',()=>{
  const level=tdLevel('2029-11-05',20), run=responsiveTd(level);
  expect(run.state.passed).toBe(true);
  expect(run.inputs.some(i=>i.type==='sell')).toBe(true);
  expect(run.state.inputsRejected).toBe(0);
  const verified=replayTd({level},run.inputs,run.state.tick);
  expect({...verified,events:[]}).toEqual(run.state);
});
