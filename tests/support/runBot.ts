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
  collisions: number;
}
export const BOT_REACTION_TICKS = 15;
export const BOT_SAMPLE_TICKS = 6;
// Use live speed for action timing; never assume starting speed or ramp duration.
const GOOD_LOOKAHEAD = 21_500;
const GOOD_LOOKAHEAD_TICKS = 44;

/** Search a time/lane graph using only public snapshots. Each edge is a legal
 * 12-tick lane change or wait, with swept occupancy checked on both halves. */
export function searchDirection(s: RunState, reaction = 0, horizon = 120): RunDirection | null {
  const ramps = s.objects.filter(o => o.kind === "ramp");
  const vans = s.objects.filter(o => o.kind === "van");
  const roofSafe = (o: RunState["objects"][number]): boolean => o.kind === "van" &&
    (ramps.some(r => r.lane === o.lane && r.z + r.back === o.z - o.front) ||
      (s.player.lane === o.lane && s.player.surface === "roof" && o.z - o.front <= 0) ||
      vans.some(v => v.lane === o.lane && v.z < o.z && v.z + v.back === o.z - o.front && roofSafe(v)));
  const actionGate = (o: RunState["objects"][number]) =>
    (o.kind === "flour" || o.kind === "awning") &&
    s.objects.filter(h => h.z === o.z && h.kind === "cart").length === 2;
  const hazards = s.objects.filter(o => isRunObstacle(o.kind) && o.kind !== "ramp" && o.kind !== "pothole" && !actionGate(o) && !roofSafe(o));
  const failed = new Set<string>();
  const travel = [0];
  for (let t = 1; t <= 180; t++) travel[t] = travel[t - 1] + runSpeed(s.tick + t, s.powerUps.coffeeUntil > s.tick + t);
  function safe(lane: RunLane, from: number, to: number) {
    return !hazards.some(o => {
      const overlaps = (start: number, end: number) => start <= end &&
        o.z - travel[end] - (o.speed ?? 0) * end <= o.front + 400 &&
        o.z - travel[start - 1] - (o.speed ?? 0) * (start - 1) >= -o.back - 400;
      const shift = o.signalUntil ? o.signalUntil - s.tick : Infinity;
      return (o.lane === lane && overlaps(from, Math.min(to, shift - 1))) ||
        (o.targetLane === lane && overlaps(Math.max(from, shift), to));
    });
  }
  function search(lane: RunLane, t: number): (RunDirection | null)[] | null {
    if (t >= horizon) return [];
    const key = `${lane}:${t}`;
    if (failed.has(key)) return null;
    for (const target of [lane, lane - 1, lane + 1]) {
      if (target < 0 || target > 2) continue;
      const delay = target === lane ? 0 : reaction;
      if (!safe(lane, t + 1, t + (target === lane ? 12 : delay + 5)) ||
          (target !== lane && (!safe(target as RunLane, t + delay + 6, t + delay + 12) ||
            s.objects.some(o => roofSafe(o) && o.lane === target &&
              o.z - travel[t + delay + 6] < o.front + 4000 && o.z - travel[t + delay + 6] > -o.back)))) continue;
      const rest = search(target as RunLane, t + delay + 12);
      if (rest) return [target === lane ? null : target < lane ? "L" : "R", ...rest];
    }
    failed.add(key); return null;
  }
  return search(s.player.lane, 0)?.[0] ?? null;
}

function run(seed: string, limit: number, mode: "good" | "random" | "perfect" | "ground" | "intermediate"): RunBotResult {
  const game = createRunGame({ seed });
  const rng = createRng(`${seed}:run:bot`);
  const inputs: RunInput[] = [];
  const pending: RunInput[] = [];
  let handledRow = -1;
  let nextRandom = 0;
  let s = game.state();
  let peakY = 0, collisions = 0;
  function swipe(dir: RunDirection) {
    collisions += game.input(s.tick, dir).filter(e => e.type === "collision").length;
    inputs.push({ tick: s.tick, dir });
    s = game.state();
  }
  while (!s.over && s.tick < limit) {
    if (mode === "random") {
      if (s.tick >= nextRandom) {
        swipe((["L", "R", "U", "D"] as const)[rng.int(4)]);
        nextRandom = s.tick + 12 + rng.int(25);
      }
    } else if (mode === "intermediate") {
      if (pending[0]?.tick === s.tick) swipe(pending.shift()!.dir);
      if (s.tick % 6 === 0) {
        const gate = s.objects.find(o =>
          (o.kind === "flour" || o.kind === "awning") &&
          o.z > 0 && o.z <= s.speed * 33 &&
          s.objects.filter(h => h.z === o.z && h.kind === "cart").length === 2);
        function queue(dir: RunDirection) {
          let tick = s.tick + BOT_REACTION_TICKS;
          while (pending.some(i => i.tick === tick)) tick++;
          pending.push({tick,dir}); pending.sort((a,b)=>a.tick-b.tick);
        }
        if (gate && s.player.pose !== "jump" && s.player.pose !== "slide" && !pending.some(i => i.dir === "U" || i.dir === "D"))
          queue(gate.kind === "awning" ? "D" : "U");
        if (!s.player.laneChange && !pending.some(i => i.dir === "L" || i.dir === "R")) {
          const dir = searchDirection({...s, objects:s.objects.map(o => ({...o, kind:o.kind === "pothole" ? "cart" : o.kind}))}, BOT_REACTION_TICKS + 6, 72);
          if (dir) queue(dir);
        }
      }
    } else if (mode === "perfect" || mode === "ground") {
      const gate = s.objects.find(o =>
        (o.kind === "flour" || o.kind === "awning" || (o.kind === "pothole" && o.lane === s.player.lane)) && o.z > 0 && o.z <= s.speed * 18 &&
        (o.kind === "pothole" || s.objects.filter(h => h.z === o.z && h.kind === "cart").length === 2));
      if (gate && s.player.pose !== "jump" && s.player.pose !== "slide") swipe(gate.kind === "awning" ? "D" : "U");
      else if (!s.player.laneChange && s.tick % 6 === 0) {
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
    collisions += game.step(s.tick + 1).filter(e => e.type === "collision").length;
    s = game.state();
    peakY = Math.max(peakY, s.player.y);
  }
  return { inputs, state: s, endTick: s.tick, over: s.over, peakY, collisions };
}
export const goodRun = (seed: string, limit = MAX_RUN_TICKS) => run(seed, limit, "good");
export const randomRun = (seed: string, limit = MAX_RUN_TICKS) => run(seed, limit, "random");
export const perfectRun = (seed: string, limit = MAX_RUN_TICKS) => run(seed, limit, "perfect");

/** Delayed, random choice among apparently open lanes; no future search. */
export const casualRun = goodRun;

/** Ground control uses the same snapshot search but never enters a ramp. */
export const groundOnlyRun = (seed: string, limit = MAX_RUN_TICKS) => run(seed, limit, "ground");

/** Roof routes are mandatory in v8; the snapshot search includes ramp support. */
export const roofRun = perfectRun;

/** Snapshot planning with a real 250 ms input queue; no privileged route data. */
export const intermediateRun = (seed: string, limit = MAX_RUN_TICKS) => run(seed, limit, "intermediate");
