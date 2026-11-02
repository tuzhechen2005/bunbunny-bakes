import { MAX_INPUTS, towerStats, validTdInput, type TdGame, type TdInput, type TdState } from '@/lib/td';

export const TD_CLIENT_REJECT_LIMIT = 100;

/** Check current state after settling the clock; ignored taps must not mutate the replay counters. */
function affordableAction(state: TdState, input: TdInput): boolean {
  if (input.type === 'callWave') return state.nextWaveTick !== null || state.awaitingStart;
  if (input.type === 'switch') return true;
  if (input.type === 'item') return !state.itemsUsed[input.item];
  const tower = state.towers.find(t => t.slot === input.slot);
  if (input.type === 'place') return !tower && state.coins >= towerStats(input.tower).cost;
  if (input.type === 'sell') return !!tower;
  return !!tower && tower.level < 2 && state.coins >= towerStats(tower.kind, tower.level + 1).cost;
}

export function applyTdClientInput(game: TdGame, inputs: TdInput[], input: TdInput): boolean {
  const state = game.state();
  if (state.over || inputs.length >= MAX_INPUTS || !validTdInput(input) || input.tick !== state.tick) return false;
  if (state.inputsRejected >= TD_CLIENT_REJECT_LIMIT && !affordableAction(state, input)) return false;
  const accepted = game.apply(input);
  inputs.push(input);
  return accepted;
}
