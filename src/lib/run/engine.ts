import { createRunTrack } from "./track";
import {
  BASE_SPEED, CAP_SPEED, RAMP_TICKS, MAX_RUN_TICKS, MAX_INPUTS, JUMP_TICKS,
  SLIDE_TICKS, LANE_CHANGE_TICKS, MAGNET_TICKS, COFFEE_TICKS, VISIBLE_DISTANCE,
  UNITS_PER_METRE, RunReplayError,
  type RunDirection, type RunGame, type RunLane, type RunEvent, type RunObject,
  type RunObstacleKind, type RunPlayer,
} from "./types";

export function runSpeed(tick: number, coffee = false): number {
  const base = BASE_SPEED + Math.floor((CAP_SPEED - BASE_SPEED) * Math.min(tick, RAMP_TICKS) / RAMP_TICKS);
  return coffee ? Math.floor(base * 3 / 2) : base;
}
export function isRunObstacle(kind: RunObject["kind"]): kind is RunObstacleKind {
  return kind === "cart" || kind === "flour" || kind === "awning" || kind === "puddle";
}
export function validRunTick(tick: number): boolean {
  return Number.isSafeInteger(tick) && tick >= 0 && tick <= MAX_RUN_TICKS;
}
export function validRunDirection(dir: unknown): dir is RunDirection {
  return dir === "L" || dir === "R" || dir === "U" || dir === "D";
}

export function createRunGame({ seed }: { seed: string }): RunGame {
  const track = createRunTrack(seed);
  let tick = 0, distance = 0, bread = 0, over = false;
  let lane: RunLane = 1;
  let action: "jump" | "slide" | null = null;
  let actionStart = 0, actionEnd = 0;
  let change: { from: RunLane; to: RunLane; start: number; end: number } | null = null;
  let queued: "L" | "R" | null = null;
  let magnetUntil = 0, coffeeUntil = 0;
  let lastInput = -1, inputCount = 0;
  let objects: RunObject[] = [], head = 0, generatedEnd = 0;
  let events: RunEvent[] = [];

  function fill() {
    while (generatedEnd < distance + VISIBLE_DISTANCE) {
      const chunk = track.next();
      // Compact only at chunk boundaries, keeping simulation work/memory bounded.
      objects = objects.slice(head).concat(chunk.objects);
      head = 0;
      generatedEnd = chunk.end;
    }
  }
  fill();

  function startLane(dir: "L" | "R") {
    const to = lane + (dir === "L" ? -1 : 1);
    if (to < 0 || to > 2) return;
    change = { from: lane, to: to as RunLane, start: tick, end: tick + LANE_CHANGE_TICKS };
    events.push({ type: "action", tick, dir });
  }

  function advance(toTick: number) {
    while (tick < toTick && !over) {
      tick++;
      if (magnetUntil === tick) events.push({ type: "expire", tick, kind: "paper-bag" });
      if (coffeeUntil === tick) events.push({ type: "expire", tick, kind: "coffee" });
      if (action && tick >= actionEnd) action = null;
      if (change && tick >= change.end) {
        lane = change.to;
        change = null;
        if (queued) { const dir = queued; queued = null; startLane(dir); }
      }
      distance += runSpeed(tick, coffeeUntil > tick);
      // Swept crossing checks: no object can be skipped by a high-speed tick.
      while (head < objects.length && objects[head].z <= distance) {
        const obj = objects[head++];
        const occupied = obj.lane === lane || obj.lane === change?.to;
        if (isRunObstacle(obj.kind)) {
          const clears = coffeeUntil > tick || !occupied ||
            (obj.kind === "awning" && action === "slide") ||
            ((obj.kind === "flour" || obj.kind === "puddle") && action === "jump");
          if (!clears) {
            over = true;
            events.push({ type: "collision", tick, id: obj.id, kind: obj.kind, lane: obj.lane });
            events.push({ type: "over", tick, reason: "collision" });
            break;
          }
        } else if (obj.lane === lane || (obj.kind === "bread" && magnetUntil > tick)) {
          if (obj.kind === "bread") bread++;
          else if (obj.kind === "paper-bag") magnetUntil = tick + MAGNET_TICKS;
          else coffeeUntil = tick + COFFEE_TICKS;
          events.push({ type: "collect", tick, id: obj.id, kind: obj.kind, lane: obj.lane });
        }
      }
      if (tick === MAX_RUN_TICKS && !over) {
        over = true;
        events.push({ type: "over", tick, reason: "limit" });
      }
      fill();
    }
  }

  function checkTime(toTick: number) {
    if (!validRunTick(toTick)) throw new RunReplayError("bad tick");
    if (toTick < tick) throw new RunReplayError("cannot rewind tick");
  }
  function player(): RunPlayer {
    const laneChange = change ? {
      from: change.from, to: change.to,
      progress: Math.floor((tick - change.start) * 1000 / LANE_CHANGE_TICKS),
    } : null;
    return {
      lane, pose: action ?? (change ? "lane-change" : "run"),
      progress: action ? Math.floor((tick - actionStart) * 1000 / (actionEnd - actionStart)) : laneChange?.progress ?? 0,
      laneChange, queuedLane: queued,
    };
  }
  return {
    step(toTick) {
      checkTime(toTick);
      if (over) return [];
      events = [];
      advance(toTick);
      return events.map((e) => ({ ...e }));
    },
    input(at, dir) {
      checkTime(at);
      if (!validRunDirection(dir)) throw new RunReplayError("bad input direction");
      if (at <= lastInput) throw new RunReplayError("input ticks not increasing");
      if (inputCount >= MAX_INPUTS) throw new RunReplayError("too many inputs");
      if (over) throw new RunReplayError("input after game over");
      events = [];
      advance(at);
      if (over) throw new RunReplayError("input after game over");
      lastInput = at;
      inputCount++;
      if (dir === "L" || dir === "R") {
        if (change) { if (queued === null) queued = dir; }
        else startLane(dir);
      } else if (!action) {
        action = dir === "U" ? "jump" : "slide";
        actionStart = tick;
        actionEnd = tick + (action === "jump" ? JUMP_TICKS : SLIDE_TICKS);
        events.push({ type: "action", tick, dir });
      }
      return events.map((e) => ({ ...e }));
    },
    state() {
      return {
        tick, player: player(),
        objects: objects.slice(head).filter((o) => o.z > distance && o.z <= distance + VISIBLE_DISTANCE)
          .map((o) => ({ ...o, z: o.z - distance })),
        speed: runSpeed(tick, coffeeUntil > tick), distance, bread,
        score: Math.floor(distance / UNITS_PER_METRE) + bread * 10, over,
        powerUps: { magnetUntil, coffeeUntil, magnetTicks: Math.max(0, magnetUntil - tick), coffeeTicks: Math.max(0, coffeeUntil - tick) },
        events: events.map((e) => ({ ...e })),
      };
    },
  };
}
