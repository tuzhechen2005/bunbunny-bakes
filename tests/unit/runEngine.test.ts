import { describe, expect, it } from "vitest";
import {
  createRunGame, replayRun, RunReplayError, RUN_ENGINE_VERSION, MAX_RUN_TICKS,
  MAX_INPUTS, BASE_SPEED, CAP_SPEED, RAMP_TICKS, JUMP_TICKS, SLIDE_TICKS, runSpeed,
  LANE_CHANGE_TICKS, type RunInput, type RunEvent,
} from "@/lib/run";
import { goodRun, casualRun, randomRun, perfectRun } from "../support/runBot";

const result = (s: ReturnType<ReturnType<typeof createRunGame>["state"]>) => ({
  score: s.score, distance: s.distance, bread: s.bread, over: s.over, endTick: s.tick,
});

describe("run engine", () => {
  it("starts with integer units, the public version, and detached snapshots", () => {
    const g = createRunGame({ seed: "copy" });
    const twin = createRunGame({ seed: "copy" });
    const s = g.state();
    expect(RUN_ENGINE_VERSION).toBe(6);
    expect(s).toMatchObject({ tick: 0, distance: 0, score: 0, bread: 0, speed: BASE_SPEED, over: false, player: { lane: 1, pose: "run" } });
    s.objects[0].lane = 2; s.objects.pop(); s.player.lane = 2;
    s.powerUps.coffeeUntil = 999; s.events.push({ type: "over", tick: 0, reason: "limit" });
    expect(g.state()).toEqual(twin.state());
    g.step(100); twin.step(40); twin.step(100);
    expect(g.state()).toEqual(twin.state());
  });

  it("has fixed actions, one queued lane change, and consumes harmless swipes", () => {
    const g = createRunGame({ seed: "actions" });
    g.input(0, "L"); g.input(1, "R"); g.input(2, "R");
    g.step(LANE_CHANGE_TICKS);
    expect(g.state().player).toMatchObject({ lane: 0, laneChange: { to: 1 }, queuedLane: null });
    g.step(LANE_CHANGE_TICKS * 2);
    expect(g.state().player).toMatchObject({ lane: 1, laneChange: null, pose: "run" });
    g.input(25, "U"); g.input(26, "D");
    g.step(25 + JUMP_TICKS - 1); expect(g.state().player.pose).toBe("jump");
    g.step(25 + JUMP_TICKS); expect(g.state().player.pose).toBe("run");
    g.input(25 + JUMP_TICKS, "D");
    g.step(25 + JUMP_TICKS + SLIDE_TICKS); expect(g.state().player.pose).toBe("run");
  });

  it("is deterministic across live input, replay, and different stepping schedules", () => {
    for (let n = 0; n < 20; n++) {
      const seed = `replay${n}`;
      const run = goodRun(seed, 60 * 240);
      const a = createRunGame({ seed }); const b = createRunGame({ seed });
      const eventsA: RunEvent[] = [], eventsB: RunEvent[] = [];
      for (const input of run.inputs) {
        eventsA.push(...a.input(input.tick, input.dir));
        while (b.state().tick < input.tick) eventsB.push(...b.step(Math.min(input.tick, b.state().tick + 7)));
        eventsB.push(...b.input(input.tick, input.dir));
        expect({ ...a.state(), events: [] }).toEqual({ ...b.state(), events: [] });
      }
      eventsA.push(...a.step(run.endTick)); eventsB.push(...b.step(run.endTick));
      expect(eventsA).toEqual(eventsB);
      expect(result(a.state())).toEqual(result(b.state()));
      expect(replayRun(seed, run.inputs, run.endTick)).toEqual(result(a.state()));
      expect(a.state().score).toBe(Math.floor(a.state().distance / 1000) + a.state().bread * 10);
    }
  });

  it("ramps to the cap and forces a surviving run to end at exactly 15 minutes", () => {
    const run = perfectRun("long", MAX_RUN_TICKS);
    expect(run).toMatchObject({ over: true, endTick: MAX_RUN_TICKS });
    expect(replayRun("long", run.inputs, MAX_RUN_TICKS)).toEqual(result(run.state));
    expect(runSpeed(1)).toBe(BASE_SPEED);
    expect(runSpeed(RAMP_TICKS)).toBe(CAP_SPEED);
    expect(runSpeed(MAX_RUN_TICKS)).toBe(CAP_SPEED);
  });

  it("distinguishes skilled play with reaction delay from random swiping", () => {
    const good = [], random = [];
    for (let n = 0; n < 100; n++) {
      good.push(casualRun(`tuning${n}`).endTick);
      random.push(randomRun(`tuning${n}`).endTick);
    }
    good.sort((a, b) => a - b); random.sort((a, b) => a - b);
    expect(good[50]).toBeGreaterThanOrEqual(30 * 60);
    expect(good[50]).toBeLessThanOrEqual(60 * 60);
    expect(good.filter(t => t >= 30 * 60 && t <= 60 * 60).length).toBeGreaterThanOrEqual(80);
    expect(random[50]).toBeLessThan(20 * 60);
  }, 30_000);

  it("pins version-six scoring and a nontrivial seeded run", () => {
    const run = goodRun("pinned");
    expect(replayRun("pinned", run.inputs, run.endTick)).toEqual({
      score: 1214, distance: 944455, bread: 27, over: true, endTick: 2549,
    });
    expect(run.inputs.slice(0, 5)).toEqual([
      { tick: 122, dir: "D" }, { tick: 524, dir: "U" }, { tick: 777, dir: "L" },
      { tick: 911, dir: "U" }, { tick: 1036, dir: "U" },
    ]);
  });

  it("accepts exactly MAX_INPUTS, counts busy no-ops, and rejects the next live input", () => {
    const run = perfectRun("input-cap");
    const byTick = new Map(run.inputs.map((input) => [input.tick, input]));
    for (let tick = 0; byTick.size < MAX_INPUTS; tick++) {
      if (!byTick.has(tick)) byTick.set(tick, { tick, dir: "U" });
    }
    const inputs = [...byTick.values()].sort((a, b) => a.tick - b.tick);
    const game = createRunGame({ seed: "input-cap" });
    for (const input of inputs) game.input(input.tick, input.dir);
    const before = game.state();
    expect(before.over).toBe(false);
    expect(() => game.input(before.tick + 1, "U")).toThrow(/too many inputs/);
    expect(game.state()).toEqual(before);
    game.step(MAX_RUN_TICKS);
    expect(result(game.state())).toEqual(result(run.state));
    replayRun("input-cap", inputs, MAX_RUN_TICKS); // Warm validation and the capped-input path.
    const timings = Array.from({ length: 3 }, () => {
      const start = performance.now();
      expect(replayRun("input-cap", inputs, MAX_RUN_TICKS)).toEqual(result(run.state));
      return performance.now() - start;
    }).sort((a, b) => a - b);
    // Median excludes a single scheduler/GC interruption on a busy shared host.
    expect(timings[1]).toBeLessThan(100);
  });

  it("replays a full 15-minute surviving log in under 100 ms", () => {
    const run = perfectRun("perf", MAX_RUN_TICKS);
    expect(run.endTick).toBe(MAX_RUN_TICKS);
    replayRun("perf", run.inputs, MAX_RUN_TICKS); // Warm module/JIT paths.
    const start = performance.now();
    const replay = replayRun("perf", run.inputs, MAX_RUN_TICKS);
    expect(performance.now() - start).toBeLessThan(100);
    expect(replay).toEqual(result(run.state));
  });
});

describe("run replay validation", () => {
  const bad = (inputs: unknown, endTick = 100, message = /./) => {
    expect(() => replayRun("errors", inputs as RunInput[], endTick)).toThrow(RunReplayError);
    expect(() => replayRun("errors", inputs as RunInput[], endTick)).toThrow(message);
  };
  it("accepts empty and unfinished prefixes including tick zero", () => {
    expect(replayRun("empty", [], 0)).toEqual({ score: 0, distance: 0, bread: 0, over: false, endTick: 0 });
    expect(replayRun("empty", [{ tick: 0, dir: "L" }], 1).over).toBe(false);
  });
  it("rejects invalid input shapes, ticks, ordering, limits and directions", () => {
    for (const value of [null, {}, "x"]) bad(value, 100, /array/);
    for (const value of [null, [], 1, {}, { tick: 0 }, { tick: 0, dir: "X" }, { tick: 0, dir: "L", extra: 1 }]) bad([value]);
    for (const tick of [-1, 0.5, NaN, Infinity, "1", Number.MAX_SAFE_INTEGER + 1, MAX_RUN_TICKS + 1]) bad([{ tick, dir: "L" }]);
    for (const end of [-1, 0.5, Infinity, NaN, MAX_RUN_TICKS + 1]) bad([], end, /end tick/);
    bad([{ tick: 1, dir: "L" }], 0, /end tick/);
    bad([{ tick: 1, dir: "L" }, { tick: 1, dir: "R" }], 100, /increasing/);
    bad([{ tick: 2, dir: "L" }, { tick: 1, dir: "R" }], 100, /increasing/);
    bad(Array.from({ length: MAX_INPUTS + 1 }, (_, tick) => ({ tick, dir: "L" })), MAX_RUN_TICKS, /too many/);
  });
  it("rejects inputs after death and disallows live rewind without mutation", () => {
    const g = createRunGame({ seed: "errors" });
    g.step(100);
    const before = g.state();
    expect(() => g.step(99)).toThrow(RunReplayError);
    expect(() => g.input(99, "L")).toThrow(RunReplayError);
    expect(() => g.input(100, "X" as never)).toThrow(RunReplayError);
    expect(g.state()).toEqual(before);
    g.step(MAX_RUN_TICKS);
    const dead = g.state();
    expect(dead.over).toBe(true);
    bad([{ tick: dead.tick, dir: "L" }], MAX_RUN_TICKS, /after game over/);
    bad([{ tick: dead.tick + 1, dir: "L" }], MAX_RUN_TICKS, /after game over/);
    g.step(MAX_RUN_TICKS); expect(g.state()).toEqual(dead);
  });
});

it("reuses live frame storage while matching detached authoritative replay",()=>{
  const seed='v6.live-frame', path=goodRun(seed,3600);
  const live=createRunGame({seed,realtime:true});
  const replay=createRunGame({seed});
  const first=live.frame(0),player=first.player,powers=first.powerUps,objects=first.objects;
  let input=0;
  for(let tick=1;tick<=path.endTick;tick++) {
    while(input<path.inputs.length&&path.inputs[input].tick<=tick) {
      const i=path.inputs[input++];live.input(i.tick,i.dir);replay.input(i.tick,i.dir);
    }
    replay.step(tick);
    const frame=live.frame(tick);
    expect(frame).toBe(first);expect(frame.player).toBe(player);
    expect(frame.powerUps).toBe(powers);expect(frame.objects).toBe(objects);
    expect(frame).toEqual(replay.state());
  }
});
