import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createTdGame, replayTd, tdLevelFromSeed, type TdInput } from '@/lib/td';
import legacy from '../fixtures/td13-run.json';

// Fixture generated using git HEAD's v13 engine and greedyTd policy, not v14 code.
it('reproduces recorded v13 level definitions and exact terminal state', () => {
  for (const {n,hash} of legacy.hashes) {
    const level = tdLevelFromSeed(`v13.td.2026-10-19.${n}`);
    expect(createHash('sha256').update(JSON.stringify(level)).digest('hex')).toBe(hash);
  }
  expect(replayTd({seed:legacy.seed},legacy.inputs as TdInput[],legacy.state.tick)).toEqual(legacy.state);
});

it('resumes a serialized v13 input-prefix save with v13 coins, boss phases and score', () => {
  const inputs = legacy.inputs as TdInput[];
  const save = JSON.parse(JSON.stringify({seed:legacy.seed,inputs:inputs.filter(i=>i.tick<=3000),endTick:3000}));
  const game = createTdGame({seed:save.seed});
  expect(game.state().coins).toBe(75);
  for (const input of save.inputs) game.apply(input);
  game.step(save.endTick);
  expect(game.state()).toEqual(replayTd({seed:save.seed},save.inputs,save.endTick));
  for (const input of inputs.filter(i=>i.tick>save.endTick)) game.apply(input);
  game.step(legacy.state.tick);
  expect(game.state()).toEqual(legacy.state);
});

it('rejects versions never retained, including v12 and older', () => {
  for (const version of [1,2,3,4,5,6,7,8,9,10,11,12,15]) {
    expect(()=>tdLevelFromSeed(`v${version}.td.2026-10-19.1`)).toThrow();
  }
});
