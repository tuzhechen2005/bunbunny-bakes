import { createRunGame, validRunDirection, validRunTick } from "./engine";
import { MAX_INPUTS, RunReplayError, type RunInput, type RunReplayResult } from "./types";

/** Validate the entire log before simulation, including any tail after a collision. */
export function replayRun(seed: string, inputs: readonly RunInput[], endTick: number): RunReplayResult {
  if (!Array.isArray(inputs)) throw new RunReplayError("inputs is not an array");
  if (inputs.length > MAX_INPUTS) throw new RunReplayError("too many inputs");
  if (!validRunTick(endTick)) throw new RunReplayError("bad end tick");
  let previous = -1;
  for (const input of inputs) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).sort().join(",") !== "dir,tick") {
      throw new RunReplayError("bad input");
    }
    if (!validRunTick(input.tick)) throw new RunReplayError("bad input tick");
    if (!validRunDirection(input.dir)) throw new RunReplayError("bad input direction");
    if (input.tick <= previous) throw new RunReplayError("input ticks not increasing");
    if (input.tick > endTick) throw new RunReplayError("input beyond end tick");
    previous = input.tick;
  }
  const game = createRunGame({ seed });
  for (const input of inputs) game.input(input.tick, input.dir);
  game.step(endTick);
  const state = game.state();
  return { score: state.score, distance: state.distance, bread: state.bread, over: state.over, endTick: state.tick };
}
