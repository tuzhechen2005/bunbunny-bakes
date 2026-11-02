import { createRng } from "../game/rng";
import { createM3Game, immediateM3Score, legalM3Moves } from "./engine";
import { m3Seed } from "./seed";
import type { M3Move } from "./types";

export interface M3Level { seed: string; moves: number; target: number; tierCount: number }
const cache = new Map<string, M3Level>();

/** Constructive proof with one-move lookahead. This generator may inspect refill outcomes;
 * the independent benchmark bot sees only the current public board. No proof is sent to clients.
 */
export function m3LevelWitness(level: M3Level): M3Move[] | null {
  const tiers = Array.from({ length: level.tierCount }, (_, i) => ({ id: String(i) }));
  for (let attempt = 0; attempt < 4; attempt++) {
    const rng = createRng(`${level.seed}:witness:${attempt}`);
    let game = createM3Game({ ...level, tiers });
    const moves: M3Move[] = [];
    while (!game.over) {
      const state = game.state();
      const legal = legalM3Moves(state);
      if (level.tierCount < 6) {
        const scores = legal.map(move => immediateM3Score(state, move.a, move.b)!);
        const best = Math.max(...scores);
        const choices = legal.filter((_, i) => scores[i] === best);
        const move = choices[rng.int(choices.length)];
        game.swap(move.a, move.b);
        moves.push({ ...move, at: moves.length * 500 });
        continue;
      }
      const candidates = legal.map(move => {
        const next = game.fork();
        next.swap(move.a, move.b);
        return { move, game: next };
      });
      const best = Math.max(...candidates.map(c => c.game.score));
      const choices = candidates.filter(c => c.game.score === best);
      const chosen = choices[rng.int(choices.length)];
      game = chosen.game;
      moves.push({ ...chosen.move, at: moves.length * 500 });
    }
    if (game.score >= level.target) return moves;
  }
  return null;
}

/** Cheap rules for HUD/resume. Only the server needs to search for the weekly seed. */
export function m3LevelRules(n: number): Omit<M3Level, "seed"> {
  if (!Number.isSafeInteger(n) || n < 1 || n > 2_147_483_646) throw new RangeError("bad m3 level");
  let moves = Math.max(8, 9 - Math.floor((n - 1) / 20));
  let target = Math.round((6000 + 3000 * (1 - Math.exp(-(((n - 1) / 40) ** 1.6)))) / 10) * 10;
  // D184: new-kind relief, then staged recovery. Calibrated on 100 independent weeks.
  // The six-kind transition needs a longer buffer than the initial +2-move candidate.
  const age = n >= 19 ? n - 19 : n >= 7 ? n - 7 : 99;
  const reliefMoves = n >= 19 ? [6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1] : [3, 3, 3, 3, 2, 2, 1, 1];
  moves += reliefMoves[age] ?? 0;
  const discount = age < 2 ? 0.30 : age < 4 ? 0.20 : age < 6 ? 0.10 : 0;
  target = Math.round(target * (1 - discount) / 10) * 10;
  return { moves, target, tierCount: n < 7 ? 4 : n < 19 ? 5 : 6 };
}

/** Public weekly deal: no secret, player id, clock, or product metadata affects it.
 * Bounded late-game parameters keep the endless level sequence playable.
 */
export function m3Level(weekKey: string, n: number): M3Level {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) throw new RangeError("bad m3 week");
  const rules = m3LevelRules(n);
  const key = `${weekKey}:${n}`;
  const cached = cache.get(key);
  if (cached) return { ...cached };
  const rng = createRng(`m3:v4:level:${key}`);
  // Reject an unsuitable board, never lower the difficulty or hand out an impossible deal.
  for (;;) {
    const seed = m3Seed(Array.from({ length: 4 }, () => rng.int(0x100000000).toString(16).padStart(8, "0")).join(""));
    const level = { seed, ...rules };
    if (!m3LevelWitness(level)) continue;
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, level);
    return { ...level };
  }
}
