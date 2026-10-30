import { createM3Game } from "./engine";
import { validCell } from "./board";
import { MAX_MOVES, MIN_MOVE_GAP_MS, type M3Move, type M3TierInput } from "./types";

export interface M3ReplayResult { score: number; over: boolean; moves: number }
export class M3ReplayError extends Error {
  constructor(message: string) { super(message); this.name = "M3ReplayError"; }
}

/** Timestamps are safe integer milliseconds since start; first move may occur at zero. */
export function replayM3(seed: string, tiers: readonly M3TierInput[], moves: readonly M3Move[]): M3ReplayResult {
  if (!Array.isArray(moves)) throw new M3ReplayError("moves is not an array");
  // A 31st move is necessarily also after over; reject before simulating oversized input.
  if (moves.length > MAX_MOVES) throw new M3ReplayError("too many moves (move after game over)");
  const game = createM3Game({ seed, tiers });
  let prev = -1;
  for (const move of moves) {
    if (!move || typeof move !== "object" || Array.isArray(move)) throw new M3ReplayError("bad move");
    if (!validCell(move.a) || !validCell(move.b)) throw new M3ReplayError("bad move position");
    if (!Number.isSafeInteger(move.at) || move.at < 0) throw new M3ReplayError("bad move time");
    if (move.at <= prev) throw new M3ReplayError("move times not increasing");
    if (prev >= 0 && move.at - prev < MIN_MOVE_GAP_MS) throw new M3ReplayError("move gap below minimum");
    if (game.swap(move.a, move.b) === null) throw new M3ReplayError("illegal swap");
    prev = move.at;
  }
  return { score: game.score, over: game.over, moves: game.moves };
}
