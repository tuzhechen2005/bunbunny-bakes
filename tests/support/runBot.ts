// Bots inspect only public visible objects. The perfect bot searches future lane
// occupancy; the casual bot samples at 10 Hz with a 250 ms motor delay.
import { JUMP_TICKS, SLIDE_TICKS } from "../../src/lib/run/types";
import { MAX_OBSTACLE_BACK } from "../../src/lib/run/geometry";
import { createRng } from "../../src/lib/game/rng";
import {
  createRunGame, runSpeed, isRunObstacle, MAX_RUN_TICKS, LANES,
  type RunInput, type RunState, type RunDirection, type RunLane,
} from "../../src/lib/run";

export interface RunBotResult {
  inputs: RunInput[];
  state: RunState;
  endTick: number;
  over: boolean;
  peakY: number;
}
export const BOT_REACTION_TICKS = 15;
export const BOT_SAMPLE_TICKS = 6;
// Use live speed for action timing; never assume starting speed or ramp duration.
const GOOD_LOOKAHEAD = 21_500;
const GOOD_LOOKAHEAD_TICKS = 44;

/** Search a time/lane graph using only public snapshots. Each edge is a legal
 * 12-tick lane change or wait, with swept occupancy checked on both halves. */
export function searchDirection(s: RunState): RunDirection | null {
  const hazards = s.objects.filter(o => isRunObstacle(o.kind) && o.kind !== "ramp");
  const failed = new Set<string>();
  const travel = [0];
  for (let t = 1; t <= 120; t++) travel[t] = travel[t - 1] + runSpeed(s.tick + t, s.powerUps.coffeeUntil > s.tick + t);
  function safe(lane: RunLane, from: number, to: number) {
    return !hazards.some(o => o.lane === lane &&
      o.z - travel[to] - (o.speed ?? 0) * to <= o.front + 400 &&
      o.z - travel[from - 1] - (o.speed ?? 0) * (from - 1) >= -o.back - 400);
  }
  function search(lane: RunLane, t: number): (RunDirection | null)[] | null {
    if (t >= 120) return [];
    const key = `${lane}:${t}`;
    if (failed.has(key)) return null;
    for (const target of [lane, lane - 1, lane + 1]) {
      if (target < 0 || target > 2) continue;
      if (!safe(lane, t + 1, t + (target === lane ? 12 : 5)) ||
          (target !== lane && !safe(target as RunLane, t + 6, t + 12))) continue;
      const rest = search(target as RunLane, t + 12);
      if (rest) return [target === lane ? null : target < lane ? "L" : "R", ...rest];
    }
    failed.add(key); return null;
  }
  return search(s.player.lane, 0)?.[0] ?? null;
}

function run(seed: string, limit: number, mode: "good" | "random" | "perfect" | "ground"): RunBotResult {
  const game = createRunGame({ seed });
  const rng = createRng(`${seed}:run:bot`);
  const inputs: RunInput[] = [];
  const pending: RunInput[] = [];
  let handledRow = -1;
  let nextRandom = 0;
  let s = game.state();
  let peakY = 0;
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
    } else if (mode === "perfect" || mode === "ground") {
      if (!s.player.laneChange && s.tick % 12 === 0) {
        const dir = searchDirection(mode === "ground" ? { ...s, objects: s.objects.map(o => o.kind === "ramp" ? { ...o, kind: "van" as const } : o) } : s);
        if (dir) swipe(dir);
      }
    } else {
      if (pending[0]?.tick === s.tick) swipe(pending.shift()!.dir);
      if (s.tick % BOT_SAMPLE_TICKS === 0 && pending.length === 0 && !s.player.laneChange) {
        const row = s.objects.find((o) => isRunObstacle(o.kind) && o.z >= -MAX_OBSTACLE_BACK);
        if (row && row.id !== handledRow && row.z <= Math.min(GOOD_LOOKAHEAD, s.speed * GOOD_LOOKAHEAD_TICKS)) {
          handledRow = row.id;
          const obstacles = s.objects.filter((o) => o.z === row.z && isRunObstacle(o.kind));
          const danger = obstacles.find((o) => o.lane === s.player.lane);
          if (danger) {
            const at = s.tick + BOT_REACTION_TICKS;
            if (danger.kind === "cart" || danger.kind === "van" || danger.kind === "truck") {
              const choices = LANES.filter((lane) => !obstacles.some((o) => o.lane === lane));
              const target = choices[rng.int(choices.length)] as RunLane;
              const dir = target < s.player.lane ? "L" : "R";
              pending.push({ tick: at, dir });
              if (Math.abs(target - s.player.lane) === 2) pending.push({ tick: at + 1, dir });
            } else {
              // Aim the middle of the visible arc/crouch at the row centre.
              const duration = danger.kind === "awning" ? SLIDE_TICKS : JUMP_TICKS;
              const centred = s.tick + Math.round(danger.z / s.speed) - duration / 2;
              pending.push({ tick: Math.max(at, centred), dir: danger.kind === "awning" ? "D" : "U" });
            }
          }
        }
      }
    }
    game.step(s.tick + 1);
    s = game.state();
    peakY = Math.max(peakY, s.player.y);
  }
  return { inputs, state: s, endTick: s.tick, over: s.over, peakY };
}
export const goodRun = (seed: string, limit = MAX_RUN_TICKS) => run(seed, limit, "good");
export const randomRun = (seed: string, limit = MAX_RUN_TICKS) => run(seed, limit, "random");
export const perfectRun = (seed: string, limit = MAX_RUN_TICKS) => run(seed, limit, "perfect");

/** Delayed, random choice among apparently open lanes; no future search. */
export const casualRun = goodRun;

/** Ground control uses the same snapshot search but never enters a ramp. */
export const groundOnlyRun = (seed: string, limit = MAX_RUN_TICKS) => run(seed, limit, "ground");

/** Seek visible ramped roofs after the preceding row has cleared; otherwise use
 * the same ground search. No reserved-route metadata or future track access. */
export function roofRun(seed: string, limit = MAX_RUN_TICKS): RunBotResult {
  const game = createRunGame({ seed });
  const inputs: RunInput[] = [];
  let s = game.state();
  let peakY = 0;
  let targetId: number | undefined;
  while (!s.over && s.tick < limit) {
    if (!s.player.laneChange) {
      let target = s.objects.find(o => o.id === targetId);
      if (!target || target.z < -target.back) target = undefined;
      if (!target) {
        target = s.objects.find(o => o.kind === "van" && o.z - o.front > 14000 && o.z - o.front < 30000 &&
          !s.objects.some(h => isRunObstacle(h.kind) && h.kind !== "ramp" && h.id !== o.id &&
            h.z < o.z && h.z + h.back >= -2000));
        targetId = target?.id;
      }
      const dir = target ? (target.lane === s.player.lane ? null : target.lane < s.player.lane ? "L" : "R") : searchDirection(s);
      if (dir) { game.input(s.tick, dir); inputs.push({ tick: s.tick, dir }); }
    }
    game.step(s.tick + 1); s = game.state();
    peakY = Math.max(peakY, s.player.y);
  }
  return { inputs, state: s, endTick: s.tick, over: s.over, peakY };
}
