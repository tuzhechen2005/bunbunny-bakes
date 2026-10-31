import { describe, expect, it } from "vitest";
import {
  createRunGame, isRunObstacle, runSpeed, LANES, ROW_GAP, CAP_SPEED, RAMP_TICKS,
  MAGNET_TICKS, COFFEE_TICKS, JUMP_TICKS, SLIDE_TICKS, LANE_CHANGE_TICKS,
  type RunGame, type RunLane, type RunEvent, type RunObstacleKind,
} from "@/lib/run";
import { createRunTrack } from "@/lib/run/track";

function moveTo(game: RunGame, lane: RunLane) {
  let s = game.state();
  while (s.player.lane !== lane) {
    game.input(s.tick, lane < s.player.lane ? "L" : "R");
    game.step(s.tick + LANE_CHANGE_TICKS);
    s = game.state();
  }
}
function collisionFixture(kind: RunObstacleKind, adjacent = false) {
  for (let n = 0; n < 100; n++) {
    const seed = `collision${n}`;
    const objects = createRunTrack(seed).next().objects;
    const obstacle = objects.find((o) => o.z === ROW_GAP && o.kind === kind);
    if (!obstacle) continue;
    const open = LANES.find((lane) => !objects.some((o) => o.z === ROW_GAP && isRunObstacle(o.kind) && o.lane === lane))!;
    if (adjacent && Math.abs(open - obstacle.lane) !== 1) continue;
    const game = createRunGame({ seed });
    moveTo(game, obstacle.lane);
    let tick = 0, distance = 0;
    while (distance < obstacle.z) distance += runSpeed(++tick);
    return { game, obstacle, tick };
  }
  throw new Error("missing collision fixture");
}

function powerFixture(kind: "paper-bag" | "coffee") {
  for (let n = 0; n < 1000; n++) {
    const seed = `power${n}`;
    const track = createRunTrack(seed);
    const objects = Array.from({ length: 4 }, () => track.next()).flatMap((c) => c.objects);
    const powers = objects.filter((o) => o.kind === kind);
    if (powers.length !== 1 || powers[0].z !== ROW_GAP - 24_000) continue;
    const game = createRunGame({ seed });
    moveTo(game, powers[0].lane);
    while (game.state().distance < powers[0].z) game.step(game.state().tick + 1);
    return { game, power: powers[0] };
  }
  throw new Error("missing power fixture");
}
function safelyAdvance(game: RunGame, target: number): RunEvent[] {
  const events: RunEvent[] = [];
  while (game.state().tick < target && !game.state().over) {
    const s = game.state();
    const row = s.objects.find((o) => isRunObstacle(o.kind));
    if (row && row.z <= ROW_GAP && !s.player.laneChange) {
      const blocked = s.objects.filter((o) => isRunObstacle(o.kind) && o.z === row.z).map((o) => o.lane);
      const targetLane = LANES.find((lane) => !blocked.includes(lane))!;
      if (s.player.lane !== targetLane) events.push(...game.input(s.tick, targetLane < s.player.lane ? "L" : "R"));
    }
    events.push(...game.step(s.tick + 1));
  }
  expect(game.state().tick).toBe(target);
  expect(game.state().over).toBe(false);
  return events;
}

describe("run collision rules", () => {
  it.each(["cart", "flour", "awning", "puddle"] as const)("%s kills on the exact crossing tick", (kind) => {
    const { game, tick, obstacle } = collisionFixture(kind);
    game.step(tick - 1); expect(game.state().over).toBe(false);
    expect(game.step(tick)).toContainEqual({ type: "collision", tick, id: obstacle.id, kind, lane: obstacle.lane });
    expect(game.state()).toMatchObject({ over: true, tick });
    expect(game.state().events.at(-1)).toEqual({ type: "over", tick, reason: "collision" });
  });
  it.each([
    ["flour", "U", true], ["puddle", "U", true], ["awning", "D", true],
    ["cart", "U", false], ["cart", "D", false], ["awning", "U", false], ["puddle", "D", false], ["flour", "D", false],
  ] as const)("%s with %s clears=%s", (kind, dir, clears) => {
    const { game, tick } = collisionFixture(kind);
    game.input(tick - 10, dir); game.step(tick);
    expect(game.state().over).toBe(!clears);
  });
  it.each([["flour", "U", JUMP_TICKS], ["awning", "D", SLIDE_TICKS]] as const)("%s action expires before collision at its exclusive end", (kind, dir, duration) => {
    const { game, tick } = collisionFixture(kind);
    game.input(tick - duration, dir); game.step(tick);
    expect(game.state().over).toBe(true);
  });
  it("a late lane change still occupies the source lane; a completed one clears it", () => {
    for (const offset of [LANE_CHANGE_TICKS - 1, LANE_CHANGE_TICKS]) {
      const { game, tick, obstacle } = collisionFixture("cart", true);
      const row = game.state().objects.filter((o) => o.z + game.state().distance === ROW_GAP && isRunObstacle(o.kind));
      const open = LANES.find((l) => !row.some((o) => o.lane === l))!;
      // Fixture has the cart adjacent to the open lane.
      expect(Math.abs(open - obstacle.lane)).toBe(1);
      game.input(tick - offset, open < obstacle.lane ? "L" : "R"); game.step(tick);
      expect(game.state().over).toBe(offset < LANE_CHANGE_TICKS);
    }
  });
});

describe("run power-ups and timing", () => {
  it("paper bag collects every lane at the crossing and lasts exactly 480 ticks", () => {
    const { game } = powerFixture("paper-bag");
    const acquired = game.state().tick;
    expect(game.state().powerUps).toMatchObject({ magnetTicks: MAGNET_TICKS, magnetUntil: acquired + MAGNET_TICKS });
    const events = safelyAdvance(game, acquired + MAGNET_TICKS - 1);
    const bread = events.filter((e) => e.type === "collect" && e.kind === "bread");
    expect(new Set(bread.map((e) => "lane" in e ? e.lane : -1)).size).toBe(3);
    expect(bread.some((e) => bread.filter((b) => b.tick === e.tick).length === 3)).toBe(true);
    expect(game.state().powerUps.magnetTicks).toBe(1);
    expect(game.step(acquired + MAGNET_TICKS)).toContainEqual({ type: "expire", kind: "paper-bag", tick: acquired + MAGNET_TICKS });
    expect(game.state().powerUps.magnetTicks).toBe(0);
  });
  it("coffee grants integer 3/2 speed and invulnerability for exactly 360 ticks", () => {
    const { game } = powerFixture("coffee");
    const acquired = game.state().tick;
    expect(game.state().powerUps.coffeeTicks).toBe(COFFEE_TICKS);
    expect(game.state().speed).toBe(runSpeed(acquired, true));
    const obstacle = game.state().objects.find((o) => isRunObstacle(o.kind))!;
    moveTo(game, obstacle.lane);
    while (game.state().distance < ROW_GAP) game.step(game.state().tick + 1);
    expect(game.state().over).toBe(false);
    safelyAdvance(game, acquired + COFFEE_TICKS - 1);
    expect(game.state().powerUps.coffeeTicks).toBe(1);
    const before = game.state().distance;
    expect(game.step(acquired + COFFEE_TICKS)).toContainEqual({ type: "expire", tick: acquired + COFFEE_TICKS, kind: "coffee" });
    expect(game.state().distance - before).toBe(runSpeed(acquired + COFFEE_TICKS));
    expect(game.state().powerUps.coffeeTicks).toBe(0);
  });
  it.each(["paper-bag", "coffee"] as const)("refreshes %s without stacking duration", (kind) => {
    let fixture: { seed: string; first: RunLane; secondZ: number } | undefined;
    for (let n = 0; n < 20_000; n++) {
      const seed = `refresh${n}`;
      const powers = createRunTrack(seed).next().objects.filter((o) => o.kind === kind);
      if (powers.length === 2 && powers[0].z === ROW_GAP - 24_000 && powers[1].z === 2 * ROW_GAP - 24_000) {
        fixture = { seed, first: powers[0].lane, secondZ: powers[1].z }; break;
      }
    }
    expect(fixture).toBeDefined();
    const game = createRunGame({ seed: fixture!.seed });
    moveTo(game, fixture!.first);
    while (game.state().distance < ROW_GAP - 24_000) game.step(game.state().tick + 1);
    const duration = kind === "coffee" ? COFFEE_TICKS : MAGNET_TICKS;
    const oldUntil = game.state().tick + duration;
    while (game.state().distance < fixture!.secondZ) safelyAdvance(game, game.state().tick + 1);
    const s = game.state();
    expect(s.tick).toBeLessThan(oldUntil);
    const until = kind === "coffee" ? s.powerUps.coffeeUntil : s.powerUps.magnetUntil;
    expect(until).toBe(s.tick + duration);
    expect(until).toBeLessThan(oldUntil + duration);
  });

  it("caps the base speed at two minutes, with no floating point accumulation", () => {
    expect(runSpeed(0)).toBe(200);
    expect(runSpeed(RAMP_TICKS / 2)).toBe(350);
    expect(runSpeed(RAMP_TICKS - 1)).toBe(CAP_SPEED - 1);
    expect(runSpeed(RAMP_TICKS)).toBe(CAP_SPEED);
    expect(runSpeed(RAMP_TICKS * 2)).toBe(CAP_SPEED);
    expect(runSpeed(RAMP_TICKS * 2, true)).toBe(750);
  });
});
