// Server-side (and test) replay of a 兔了个兔 run: same seed + tiers + log = same score.

import { createTuGame, MAX_TAPS, TU_PROPS, type TuProp, type TuTierInput } from "./engine";

export interface TuTap {
  /** Tile id from state().tiles. */
  id: number;
  /** Integer ms since the run started on the client (Math.round it); strictly increasing. */
  at: number;
}

/** A prop use (C8), in the same log as the taps. */
export interface TuPropUse {
  p: TuProp;
  /** Same clock as TuTap.at. */
  at: number;
}

export type TuLogEntry = TuTap | TuPropUse;

export const isPropUse = (e: TuLogEntry): e is TuPropUse => "p" in e;

export interface TuReplayResult {
  score: number;
  over: boolean;
  batch: number;
  /** Accepted log entries (= log.length), taps and prop uses. */
  taps: number;
}

export class TuReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TuReplayError";
  }
}

/**
 * Re-plays a log of tile taps and prop uses. Throws TuReplayError for anything a real client
 * cannot produce: not an array, too many entries, a malformed entry (an entry is exactly
 * `{ id, at }` or `{ p, at }`), non-increasing `at`, an unknown/covered/already-taken tile, a
 * prop that is not left or not usable, or anything after game over. Timing plausibility
 * (MIN_TAP_GAP_MS, wall clock) is the server's job.
 */
export function replayTu(seed: string, tiers: readonly TuTierInput[], log: readonly TuLogEntry[]): TuReplayResult {
  if (!Array.isArray(log)) throw new TuReplayError("taps is not an array");
  if (log.length > MAX_TAPS) throw new TuReplayError("too many taps");
  const game = createTuGame({ seed, tiers });
  let prev = -1;
  for (const t of log as unknown[]) {
    if (!t || typeof t !== "object") throw new TuReplayError("bad tap");
    const e = t as Record<string, unknown>;
    const keys = Object.keys(e).sort().join(",");
    if (keys !== "at,id" && keys !== "at,p") throw new TuReplayError("bad tap");
    if ("id" in e && !Number.isSafeInteger(e.id)) throw new TuReplayError("bad tile id");
    if ("p" in e && !TU_PROPS.includes(e.p as TuProp)) throw new TuReplayError("bad prop");
    const at = e.at as number;
    if (!Number.isSafeInteger(at) || at < 0) throw new TuReplayError("bad tap time");
    if (at <= prev) throw new TuReplayError("tap times not increasing");
    if (game.over) throw new TuReplayError("tap after game over");
    if ("p" in e) {
      if (game.use(e.p as TuProp) === null) throw new TuReplayError("prop not usable");
    } else if (game.tap(e.id as number) === null) throw new TuReplayError("tile not tappable");
    prev = at;
  }
  return { score: game.score, over: game.over, batch: game.batch, taps: game.taps };
}
