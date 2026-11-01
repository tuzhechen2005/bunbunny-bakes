import { describe, expect, it } from "vitest";
import {
  LANES, ROW_GAP, MAX_SPEED, BASE_SPEED, MIN_REACTION_TICKS, MIN_REACTION_DISTANCE,
  LANE_CHANGE_TICKS, VISIBLE_DISTANCE, isRunObstacle,
} from "@/lib/run";

import { createRunTrack } from "@/lib/run/track";
import { runGeometry, TRUCK_SPEED, MAX_OBSTACLE_BACK } from "@/lib/run/geometry";
import { perfectRun, groundOnlyRun, roofRun } from "../support/runBot";

describe("run track solvability", () => {
  it("preserves a reachable open path across chunks over 1000 seeds, including maximum coffee speed", () => {
    expect((Math.ceil((VISIBLE_DISTANCE + MAX_OBSTACLE_BACK) / BASE_SPEED) + 1) * TRUCK_SPEED).toBeLessThanOrEqual(12000);
    const kinds = new Set<string>();
    let twoLaneCrossings = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const track = createRunTrack(`solvable${seed}`);
      let lane = 1, previousZ = 0, previousId = -1, previousBack = 0;
      for (let index = 0; index < 12; index++) {
        const chunk = track.next();
        expect(chunk.index).toBe(index);
        expect(chunk.start).toBe(previousZ);
        expect(chunk.end - chunk.start).toBe(ROW_GAP * 3);
        expect(chunk.objects.every((o, i, all) => o.z > chunk.start && o.z <= chunk.end + 9000 && (i === 0 || all[i - 1].z <= o.z))).toBe(true);
        const ids = chunk.objects.map((o) => o.id).sort((a, b) => a - b);
        expect(ids[0]).toBe(previousId + 1);
        expect(new Set(ids).size).toBe(ids.length);
        previousId = ids.at(-1)!;
        for (const o of chunk.objects) kinds.add(o.kind);
        for (const van of chunk.objects.filter(o => o.kind === "van")) {
          expect(van.front + van.back).toBeGreaterThanOrEqual(runGeometry.vanMinLength);
          expect(van.front + van.back).toBeLessThanOrEqual(runGeometry.vanMaxLength);
          const ramp = chunk.objects.find(o => o.kind === "ramp" && o.lane === van.lane && o.z + o.back === van.z - van.front);
          expect(ramp?.front).toBe(2000);
          expect(ramp?.back).toBe(2000);
          expect(chunk.objects.some(o => o.kind === "bread" && o.lane === van.lane && o.y === 2600 && Math.abs(o.z - van.z) < van.front)).toBe(true);
        }
        for (const truck of chunk.objects.filter(o => o.kind === "truck")) expect(truck.speed).toBe(TRUCK_SPEED);
        const obstacles = chunk.objects.filter((o) => isRunObstacle(o.kind) && o.kind !== "ramp");
        const rows = [...new Set(obstacles.map((o) => o.z))];
        expect(rows).toHaveLength(3);
        for (const z of rows) {
          const blocked = obstacles.filter((o) => o.z === z).map((o) => o.lane);
          const open = LANES.filter((l) => !blocked.includes(l));
          expect(open).toHaveLength(1);
          const changes = Math.abs(open[0] - lane);
          if (changes === 2) twoLaneCrossings++;
          const row = obstacles.filter(o => o.z === z);
          // An oncoming truck can travel at most 12m while visible, including
          // the slowest base speed. Ramps do not block the protected ground route.
          const front = Math.max(...row.map(o => o.front + (o.kind === "truck" ? 12000 : 0)));
          const free = z - previousZ - front - previousBack;
          const reaction = z <= 550000 ? MIN_REACTION_TICKS : 10;
          expect(free).toBeGreaterThanOrEqual(MAX_SPEED * (reaction + changes * LANE_CHANGE_TICKS + 1));
          if (z <= 550000) expect(free - MAX_SPEED * changes * LANE_CHANGE_TICKS).toBeGreaterThanOrEqual(MIN_REACTION_DISTANCE);
          else expect(changes).toBeLessThanOrEqual(1);
          previousBack = Math.max(...row.map(o => o.back));
          expect(VISIBLE_DISTANCE).toBeGreaterThanOrEqual(z - previousZ);
          previousZ = z; lane = open[0];
        }
      }
    }
    expect(twoLaneCrossings).toBeGreaterThan(1000);
    expect([...kinds].sort()).toEqual(["awning", "bread", "cart", "coffee", "flour", "paper-bag", "puddle", "ramp", "truck", "van"]);
  }, 15_000);

  it("executes open paths in the real engine over 1000 seeds without relying on power-ups", () => {
    for (let n = 0; n < 1000; n++) {
      const run = perfectRun(`solvable${n}`, 1200);
      expect(run.over, `seed ${n}`).toBe(false);
      expect(run.state.events.some((e) => e.type === "collision")).toBe(false);
    }
  }, 15_000);

  it("searches public snapshots for five-minute surviving paths across mature patterns", () => {
    for (let n = 0; n < 100; n++) {
      const run = perfectRun(`survive${n}`, 18001);
      expect(run.over, `seed ${n}`).toBe(false);
    }
  }, 60_000);

  it("is deterministic and changes with the seed", () => {
    const a = createRunTrack("same"), b = createRunTrack("same"), c = createRunTrack("different");
    for (let i = 0; i < 10; i++) expect(a.next()).toEqual(b.next());
    expect(createRunTrack("same").next()).not.toEqual(c.next());
  });
});


it("gives the ground-only control at least 40% fewer bread than roof play on paired five-minute tracks", () => {
  let groundBread = 0, roofBread = 0;
  for (let n = 0; n < 100; n++) {
    const seed = `reward${n}`;
    const ground = groundOnlyRun(seed, 18001), roof = roofRun(seed, 18001);
    expect(ground.over, seed).toBe(false);
    expect(ground.peakY, seed).toBe(0);
    expect(roof.peakY, seed).toBeGreaterThan(0);
    expect(roof.over, seed).toBe(false);
    groundBread += ground.state.bread; roofBread += roof.state.bread;
    expect(ground.state.bread, seed).toBeLessThanOrEqual(roof.state.bread * 0.6);
  }
  expect(groundBread).toBeLessThanOrEqual(roofBread * 0.6);
}, 60000);

it("puts most mature bread on roofs, ends each separated van train with gold, and sometimes loads trucks", () => {
  let roof = 0, ground = 0, loaded = 0, trucks = 0;
  const track = createRunTrack("roof-distribution");
  for (let i = 0; i < 100; i++) {
    const { objects } = track.next();
    for (const van of objects.filter(o => o.kind === "van")) {
      const line = objects.filter(o => o.kind === "bread" && o.lane === van.lane && o.y === van.height && o.z > van.z - van.front && o.z < van.z + van.back);
      expect(line.length).toBeGreaterThanOrEqual(3);
      expect(line.filter(o => o.value === 5)).toHaveLength(1);
      expect(line.at(-1)?.value).toBe(5);
      const street = objects.filter(o => o.kind === "bread" && o.y === 0 && o.z >= van.z - 18000 && o.z <= van.z + 8000);
      expect(street).toHaveLength(1);
    }
    for (const truck of objects.filter(o => o.kind === "truck")) {
      trucks++;
      if (objects.some(o => o.carrierId === truck.id)) loaded++;
    }
    if (i > 5) for (const bread of objects.filter(o => o.kind === "bread")) {
      if (bread.y) roof++; else ground++;
    }
  }
  expect(roof).toBeGreaterThan(ground);
  expect(loaded).toBeGreaterThan(0);
  expect(loaded).toBeLessThan(trucks);
});
