// Both bots see only the public state. Greedy never simulates hidden refill RNG.
import { createRng } from "../../src/lib/game/rng";
import {
  createM3Game, immediateM3Score, legalM3Moves, MIN_MOVE_GAP_MS,
  type M3Move, type M3State, type M3Swap, type M3TierInput,
} from "../../src/lib/m3";

export interface M3BotResult {
  moves: M3Move[];
  score: number;
  over: boolean;
  /** Earned specials, excluding transient big+roll conversions. */
  specials: number;
  fired: number;
  converted: number;
  reshuffles: number;
  clears: number;
  movesWithThreeClears: number;
  ordersCompleted: number;
  maxChain: number;
}

export function chooseM3Move(state: M3State, greedy: boolean, pick: (n: number) => number): M3Swap {
  const legal = legalM3Moves(state);
  if (!legal.length) throw new Error("m3bot: no legal move");
  if (!greedy) return legal[pick(legal.length)];
  let best = -1;
  let choices: M3Swap[] = [];
  for (const move of legal) {
    const points = immediateM3Score(state, move.a, move.b)!;
    if (points > best) { best = points; choices = [move]; }
    else if (points === best) choices.push(move);
  }
  return choices[pick(choices.length)];
}

function run(seed: string, tiers: readonly M3TierInput[], greedy: boolean): M3BotResult {
  const game = createM3Game({ seed, tiers });
  const rng = createRng(`${seed}:m3:bot`);
  const result: M3BotResult = { moves: [], score: 0, over: false, specials: 0, fired: 0, converted: 0, reshuffles: 0,
    clears: 0, movesWithThreeClears: 0, ordersCompleted: 0, maxChain: 0 };
  let at = 0;
  while (!game.over) {
    const move = chooseM3Move(game.state(), greedy, (n) => rng.int(n));
    const events = game.swap(move.a, move.b);
    if (!events) throw new Error("m3bot: swap refused");
    result.moves.push({ ...move, at });
    at += MIN_MOVE_GAP_MS + rng.int(851);
    const clears = events.filter((e) => e.type === "match").length;
    result.clears += clears;
    if (clears >= 3) result.movesWithThreeClears++;
    result.maxChain = Math.max(result.maxChain, clears);
    for (const e of events) {
      if (e.type === "special") {
        if (e.action === "created") result.specials++;
        else if (e.action === "fired") result.fired++;
        else result.converted++;
      } else if (e.type === "shuffle") result.reshuffles++;
      else if (e.type === "order" && e.action === "complete") result.ordersCompleted++;
    }
  }
  return { ...result, score: game.score, over: game.over };
}
export const randomM3 = (seed: string, tiers: readonly M3TierInput[]) => run(seed, tiers, false);
export const greedyM3 = (seed: string, tiers: readonly M3TierInput[]) => run(seed, tiers, true);
