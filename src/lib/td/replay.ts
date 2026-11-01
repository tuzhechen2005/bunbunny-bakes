import { createTdGame, validTdInput, validTdTick } from "./engine";
import { MAX_IGNORED_INPUTS, MAX_INPUTS, MAX_LEVEL_TICKS, TdReplayError, type TdInput, type TdOptions, type TdState } from "./types";

/** Validate the entire log before simulation, including any tail after a terminal tick. */
export function replayTd(opts: TdOptions, inputs: readonly TdInput[], toTick?: number): TdState {
  if (!Array.isArray(inputs)) throw new TdReplayError("inputs is not an array");
  if (inputs.length > MAX_INPUTS) throw new TdReplayError("too many inputs");
  const endTick = toTick ?? Math.min(Number.MAX_SAFE_INTEGER - MAX_LEVEL_TICKS,
    (inputs.find(input => input?.type === "callWave")?.tick ?? inputs.at(-1)?.tick ?? 0) + MAX_LEVEL_TICKS);
  if (!validTdTick(endTick)) throw new TdReplayError("bad replay tick");
  let previous = 0;
  for (const input of inputs) {
    if (!validTdInput(input)) throw new TdReplayError("bad input");
    if (input.tick < previous || input.tick > endTick) throw new TdReplayError("bad input order or tick beyond observation");
    previous = input.tick;
  }
  const game = createTdGame(opts);
  for (const input of inputs) {
    game.apply(input);
    if (game.over) throw new TdReplayError("input at or after game over");
    if (game.inputsRejected > MAX_IGNORED_INPUTS) throw new TdReplayError("too many ignored inputs");
  }
  game.step(endTick);
  return game.state();
}
