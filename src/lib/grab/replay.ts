import { createGrabGame } from "./engine";
import { MAX_IGNORED_LAUNCHES, MAX_LAUNCHES, MAX_RUN_TICKS, type GrabTierInput } from "./types";

export interface GrabReplayResult { score: number; over: boolean; grabs: number; launchesAccepted: number }
export class GrabReplayError extends Error {
  constructor(message: string) { super(message); this.name = "GrabReplayError"; }
}

/** Full replay by default. Pass an explicit observation tick for progress/save restoration. */
export function replayGrab(
  seed: string, tiers: readonly GrabTierInput[], launches: readonly number[], toTick = MAX_RUN_TICKS,
): GrabReplayResult {
  if (!Array.isArray(launches)) throw new GrabReplayError("launches is not an array");
  if (launches.length > MAX_LAUNCHES) throw new GrabReplayError("too many launches");
  if (!Number.isSafeInteger(toTick) || toTick < 0 || toTick > MAX_RUN_TICKS) throw new GrabReplayError("bad replay tick");
  const game = createGrabGame({ seed, tiers });
  let prev = -1;
  for (const tick of launches) {
    if (!Number.isSafeInteger(tick) || tick < 0 || tick > toTick) throw new GrabReplayError("bad launch tick");
    if (tick <= prev) throw new GrabReplayError("launch ticks not increasing");
    game.launch(tick);
    if (game.over) throw new GrabReplayError("launch after game over");
    if (game.launchesRejected > MAX_IGNORED_LAUNCHES) throw new GrabReplayError("too many ignored launches");
    prev = tick;
  }
  game.step(toTick);
  return { score: game.score, over: game.over, grabs: game.grabs, launchesAccepted: game.launchesAccepted };
}
