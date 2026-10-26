// Server-side (and test) replay of a run: same seed + same tiers + same drop log = same score.

import { createGame, DEFAULT_HEIGHT, DROP_COOLDOWN_STEPS, GRACE_STEPS, OVER_STEPS, type Game, type TierDef } from "./engine";

export interface ReplayDrop {
  /** World x of the drop (0..1). */
  x: number;
  /** Simulation step index of the drop. */
  at: number;
}

export interface RunLog {
  runId: string;
  seed: string;
  drops: ReplayDrop[];
}

export const MAX_DROPS = 600;
export const MAX_STEPS = 200_000;

export interface ReplayResult {
  score: number;
  over: boolean;
  steps: number;
}

export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayError";
  }
}

/** After the last drop: keep stepping until game over, rest, or the step cap (shared by replay and bots). */
export function settleGame(game: Game): void {
  const settleSteps = GRACE_STEPS + OVER_STEPS + 60;
  while (!game.over && game.steps < MAX_STEPS && (game.stepsSinceDrop() < settleSteps || !game.asleep)) game.step();
}

/**
 * Re-plays a drop log. Throws ReplayError for anything a real client cannot produce (too many
 * drops or steps, a drop inside the cool-down, a drop after game over, non-finite numbers).
 * After the last drop the world runs on until it is over or at rest, so cascades are counted.
 */
export function replay(seed: string, tiers: readonly TierDef[], drops: readonly ReplayDrop[], height = DEFAULT_HEIGHT): ReplayResult {
  if (drops.length > MAX_DROPS) throw new ReplayError("too many drops");
  const game = createGame({ seed, tiers, width: 1, height });
  let prev = -Infinity;
  for (const d of drops) {
    if (!d || !Number.isInteger(d.at) || d.at < 0 || d.at > MAX_STEPS) throw new ReplayError("bad drop time");
    if (typeof d.x !== "number" || !Number.isFinite(d.x)) throw new ReplayError("bad drop position");
    if (d.at - prev < DROP_COOLDOWN_STEPS) throw new ReplayError("drop inside the cool-down");
    while (game.steps < d.at) {
      if (game.over) throw new ReplayError("drop after game over");
      // A sleeping world only counts steps: jump straight to the drop (checked against `over`).
      game.step();
    }
    if (game.over) throw new ReplayError("drop after game over");
    if (game.drop(d.x) === null) throw new ReplayError("drop refused");
    prev = d.at;
  }
  settleGame(game);
  return { score: game.score, over: game.over, steps: game.steps };
}
