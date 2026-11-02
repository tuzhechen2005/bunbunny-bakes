// Bots observe only public snapshots. No access to the engine RNG or future oven batches.
import { createRng } from "../../src/lib/game/rng";
import {
  BREAD_REFRESH_AGE, breadPoints, createGrabGame, EXTEND_SPEED, reelSpeed, SWING_PERIOD_TICKS,
  type GrabItem, type GrabState, type GrabTierInput,
} from "../../src/lib/grab";
import { firstContact, fieldLength, swingAngle } from "../../src/lib/grab/geometry";

export interface GrabBotResult {
  launches: number[];
  score: number;
  grabs: number;
  over: boolean;
  launchesAccepted: number;
  ticks: number;
  explosions: number;
}

/** Visible-board ray estimate. The bot does not simulate unseen refills. */
function target(state: GrabState, wait: number): { item: GrabItem; distance: number } | null {
  const angle = swingAngle(state.tick + wait);
  const hit = firstContact(angle, 0, fieldLength(angle), state.items);
  return hit ? { item: state.items[hit.index], distance: hit.length } : null;
}

/** Choose a launch time from the next half-swing by points per time spent. */
export function chooseGrabWait(state: GrabState): number {
  let best = -1, bestWait = 1;
  for (let wait = 0; wait <= SWING_PERIOD_TICKS / 2; wait += 2) {
    const hit = target(state, wait);
    if (!hit || hit.item.kind === "bomb") continue;
    if (best < 0) bestWait = wait; // A safe fallback even when only flour is reachable.
    if (hit.item.kind === "flour") continue;
    const outward = Math.ceil(hit.distance / EXTEND_SPEED);
    const cost = wait + outward + Math.ceil(hit.distance / reelSpeed(hit.item.weight));
    if (cost >= state.timeLeft) continue;
    const item = hit.item;
    const points = item.kind === "bread" ? breadPoints(item.size, (item.age + wait + outward) % BREAD_REFRESH_AGE) : item.kind === "clock" ? 300 : 20;
    const utility = points / cost;
    if (utility > best) { best = utility; bestWait = wait; }
  }
  return bestWait;
}

function run(seed: string, tiers: readonly GrabTierInput[], greedy: boolean): GrabBotResult {
  const game = createGrabGame({ seed, tiers });
  const rng = createRng(`${seed}:grab:bot`);
  const launches: number[] = [];
  let nextLaunch = -1, explosions = 0;
  while (!game.over) {
    const state = game.state();
    if (state.claw.phase === "idle") {
      if (nextLaunch < state.tick) nextLaunch = state.tick + (greedy ? chooseGrabWait(state) : rng.int(18));
      if (state.tick === nextLaunch) {
        game.launch(state.tick);
        launches.push(state.tick);
        nextLaunch = -1;
      }
    }
    explosions += game.step(state.tick + 1).filter(e => e.type === "explode").length;
  }
  return { launches, explosions, score: game.score, grabs: game.grabs, over: game.over, launchesAccepted: game.launchesAccepted, ticks: game.state().tick };
}

export const randomGrab = (seed: string, tiers: readonly GrabTierInput[]) => run(seed, tiers, false);
export const greedyGrab = (seed: string, tiers: readonly GrabTierInput[]) => run(seed, tiers, true);
