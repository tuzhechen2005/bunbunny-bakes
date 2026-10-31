// Bots inspect only public visible objects. The perfect bot is a solvability/perf oracle;
// the good bot has a 250 ms motor delay and samples the scene at 10 Hz.
import { createRng } from "../../src/lib/game/rng";
import {
  createRunGame, isRunObstacle, MAX_RUN_TICKS, LANES, ROW_GAP,
  type RunInput, type RunState, type RunDirection, type RunLane,
} from "../../src/lib/run";

export interface RunBotResult {
  inputs: RunInput[];
  state: RunState;
  endTick: number;
  over: boolean;
}
export const BOT_REACTION_TICKS = 15;
export const BOT_SAMPLE_TICKS = 6;
const GOOD_LOOKAHEAD = 21_500;

function run(seed: string, limit: number, mode: "good" | "random" | "perfect"): RunBotResult {
  const game = createRunGame({ seed });
  const rng = createRng(`${seed}:run:bot`);
  const inputs: RunInput[] = [];
  const pending: RunInput[] = [];
  let handledRow = -1;
  let nextRandom = 0;
  let s = game.state();
  function swipe(dir: RunDirection) {
    game.input(s.tick, dir);
    inputs.push({ tick: s.tick, dir });
    s = game.state();
  }
  while (!s.over && s.tick < limit) {
    if (mode === "random") {
      if (s.tick >= nextRandom) {
        swipe((["L", "R", "U", "D"] as const)[rng.int(4)]);
        nextRandom = s.tick + 12 + rng.int(25);
      }
    } else if (mode === "perfect") {
      const row = s.objects.find((o) => isRunObstacle(o.kind));
      if (row && row.z <= ROW_GAP && !s.player.laneChange) {
        const blocked = s.objects.filter((o) => o.z === row.z && isRunObstacle(o.kind)).map((o) => o.lane);
        const target = LANES.find((lane) => !blocked.includes(lane))!;
        if (target !== s.player.lane) swipe(target < s.player.lane ? "L" : "R");
      }
    } else {
      if (pending[0]?.tick === s.tick) swipe(pending.shift()!.dir);
      if (s.tick % BOT_SAMPLE_TICKS === 0 && pending.length === 0 && !s.player.laneChange) {
        const row = s.objects.find((o) => isRunObstacle(o.kind));
        if (row && row.id !== handledRow && row.z <= Math.min(GOOD_LOOKAHEAD, s.speed * 44)) {
          handledRow = row.id;
          const obstacles = s.objects.filter((o) => o.z === row.z && isRunObstacle(o.kind));
          const danger = obstacles.find((o) => o.lane === s.player.lane);
          if (danger) {
            const at = s.tick + BOT_REACTION_TICKS;
            if (danger.kind === "cart") {
              const target = LANES.find((lane) => !obstacles.some((o) => o.lane === lane)) as RunLane;
              const dir = target < s.player.lane ? "L" : "R";
              pending.push({ tick: at, dir });
              if (Math.abs(target - s.player.lane) === 2) pending.push({ tick: at + 1, dir });
            } else {
              pending.push({ tick: at, dir: danger.kind === "awning" ? "D" : "U" });
            }
          }
        }
      }
    }
    game.step(s.tick + 1);
    s = game.state();
  }
  return { inputs, state: s, endTick: s.tick, over: s.over };
}
export const goodRun = (seed: string, limit = MAX_RUN_TICKS) => run(seed, limit, "good");
export const randomRun = (seed: string, limit = MAX_RUN_TICKS) => run(seed, limit, "random");
export const perfectRun = (seed: string, limit = MAX_RUN_TICKS) => run(seed, limit, "perfect");
