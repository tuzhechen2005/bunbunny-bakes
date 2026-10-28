// Server-side (and test) replay of a 兔了个兔 run: same seed + tiers + taps = same score.

import { createTuGame, MAX_TAPS, type TuTierInput } from "./engine";

export interface TuTap {
  /** Tile id from state().tiles. */
  id: number;
  /** Integer ms since the run started on the client (Math.round it); strictly increasing. */
  at: number;
}

export interface TuReplayResult {
  score: number;
  over: boolean;
  batch: number;
  /** Accepted taps (= taps.length). */
  taps: number;
}

export class TuReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TuReplayError";
  }
}

/**
 * Re-plays a tap log. Throws TuReplayError for anything a real client cannot produce: not an
 * array, too many taps, a malformed tap, non-increasing `at`, an unknown/covered/already-taken
 * tile, or a tap after game over. Timing plausibility (MIN_TAP_GAP_MS, wall clock) is the
 * server's job.
 */
export function replayTu(seed: string, tiers: readonly TuTierInput[], taps: readonly TuTap[]): TuReplayResult {
  if (!Array.isArray(taps)) throw new TuReplayError("taps is not an array");
  if (taps.length > MAX_TAPS) throw new TuReplayError("too many taps");
  const game = createTuGame({ seed, tiers });
  let prev = -1;
  for (const t of taps) {
    if (!t || typeof t !== "object") throw new TuReplayError("bad tap");
    if (!Number.isSafeInteger(t.id)) throw new TuReplayError("bad tile id");
    if (!Number.isSafeInteger(t.at) || t.at < 0) throw new TuReplayError("bad tap time");
    if (t.at <= prev) throw new TuReplayError("tap times not increasing");
    if (game.over) throw new TuReplayError("tap after game over");
    if (game.tap(t.id) === null) throw new TuReplayError("tile not tappable");
    prev = t.at;
  }
  return { score: game.score, over: game.over, batch: game.batch, taps: game.taps };
}
