import { describe, expect, it } from "vitest";
import {
  ROW_GAP, MAX_SPEED, BASE_SPEED, MIN_REACTION_TICKS, MIN_REACTION_DISTANCE,
  LANE_CHANGE_TICKS, VISIBLE_DISTANCE, isRunObstacle,
} from "@/lib/run";

import { createRunTrack, TRACK_LEAD, TRUCK_START, PRESSURE_START, ROOF_START } from "@/lib/run/track";
import { runGeometry, TRUCK_SPEED, MAX_OBSTACLE_BACK } from "@/lib/run/geometry";
import { perfectRun, groundOnlyRun } from "../support/runBot";

describe("run track solvability", () => {
  it("preserves a reachable open path across chunks over 1000 seeds, including maximum coffee speed", () => {
    expect((Math.ceil((VISIBLE_DISTANCE + MAX_OBSTACLE_BACK) / BASE_SPEED) + 1) * TRUCK_SPEED).toBeLessThanOrEqual(12000);
    const kinds = new Set<string>();
    let twoLaneCrossings = 0, changingTrucks = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const track = createRunTrack(`solvable${seed}`);
      let lane = 1, previousZ = TRACK_LEAD, previousId = -1, previousBack = 0;
      for (let index = 0; index < 16; index++) {
        const chunk = track.next();
        expect(chunk.index).toBe(index);
        expect(chunk.start).toBe(previousZ);
        expect(chunk.end - chunk.start).toBe(ROW_GAP * 3);
        expect(chunk.objects.every((o, i, all) => o.z > chunk.start && o.z <= chunk.end + 28000 && (i === 0 || all[i - 1].z <= o.z))).toBe(true);
        const ids = chunk.objects.map((o) => o.id).sort((a, b) => a - b);
        expect(ids[0]).toBe(previousId + 1);
        expect(new Set(ids).size).toBe(ids.length);
        previousId = ids.at(-1)!;
        for (const o of chunk.objects) kinds.add(o.kind);
        for (const van of chunk.objects.filter(o => o.kind === "van")) {
          expect(van.front + van.back).toBeGreaterThanOrEqual(runGeometry.vanMinLength);
          expect(van.front + van.back).toBeLessThanOrEqual(runGeometry.vanMaxLength);
          const ramp = chunk.objects.find(o => o.kind === "ramp" && o.lane === van.lane && o.z + o.back === van.z - van.front);
          if (ramp) {
            expect(ramp.front).toBe(2000); expect(ramp.back).toBe(2000);
          } else expect(chunk.objects.some(o => o.kind === "van" && o.lane === van.lane && o.z + o.back === van.z - van.front)).toBe(true);
          expect(chunk.objects.some(o => o.kind === "bread" && o.lane === van.lane && o.y === 2600 && Math.abs(o.z - van.z) < van.front)).toBe(true);
        }
        for (const truck of chunk.objects.filter(o => o.kind === "truck")) expect(truck.speed).toBe(TRUCK_SPEED);
        for (let r = 1; r <= 3; r++) {
          const z = chunk.start + r * ROW_GAP;
          const row = chunk.objects.filter(o => isRunObstacle(o.kind) && o.z === z);
          const route = chunk.objects.find(o => o.kind === "bread" && o.y === 0 && o.z === z - 12000)!;
          expect(route).toBeDefined();
          const changes = Math.abs(route.lane - lane);
          if (changes === 2) twoLaneCrossings++;
          const gate = row.find(o => o.lane === route.lane);
          if (z >= 2_340_000) expect(gate).toBeDefined();
          if (gate) expect(["flour", "awning", "van"]).toContain(gate.kind);
          if (gate?.kind === "van") {
            expect(z).toBeGreaterThanOrEqual(ROOF_START);
            expect(row.filter(o => o.kind === "cart")).toHaveLength(2);
            expect(chunk.objects.some(o => o.kind === "van" && o.lane === route.lane && o.z === z + 12000)).toBe(true);
          } else if (gate) {
            expect(z).toBeGreaterThanOrEqual(PRESSURE_START);
            expect(row.filter(o => o.kind === "cart")).toHaveLength(2);
            expect(chunk.objects.some(o => (o.kind === "cart" && o.z === z + 18000 || o.kind === "pothole" && o.z === z + 28000) && o.lane === route.lane)).toBe(true);
          }
          for (const truck of row.filter(o => o.kind === "truck")) {
            expect(truck.z).toBeGreaterThanOrEqual(TRUCK_START);
            if (truck.targetLane !== undefined) {
              changingTrucks++;
              expect(Math.abs(truck.targetLane - truck.lane)).toBe(1);
              expect(truck.targetLane).not.toBe(route.lane);
            }
          }
          for (const wheel of row.filter(o => o.kind === "bread-wheel")) {
            expect(r).toBe(2);
            expect(wheel.z).toBeGreaterThanOrEqual(TRUCK_START);
            expect(wheel.speed).toBe(runGeometry.breadWheelSpeed);
          }
          const front = Math.max(...row.map(o => o.front + (o.kind === "truck" ? 12000 : o.kind === "bread-wheel" ? 25000 : o.kind === "van" ? 4000 : 0)));
          const free = z - previousZ - front - previousBack;
          const reaction = z <= 240000 ? MIN_REACTION_TICKS : previousBack === 30200 ? 0 : 10;
          expect(free).toBeGreaterThanOrEqual(MAX_SPEED * (reaction + changes * LANE_CHANGE_TICKS + 1));
          if (z <= 240000) expect(free - MAX_SPEED * changes * LANE_CHANGE_TICKS).toBeGreaterThanOrEqual(MIN_REACTION_DISTANCE);
          else expect(changes).toBeLessThanOrEqual(1);
          previousBack = gate?.kind === "van" ? 18000 : gate?.kind === "awning" ? 30200 : gate ? 19400 : Math.max(...row.map(o => o.back));
          expect(VISIBLE_DISTANCE).toBeGreaterThanOrEqual(z - previousZ);
          previousZ = z; lane = route.lane;
        }
      }
    }
    expect(twoLaneCrossings).toBeGreaterThan(300);
    expect(changingTrucks).toBeGreaterThan(0);
    expect([...kinds].sort()).toEqual(["awning", "bread", "bread-wheel", "cart", "coffee", "double-jump-shoes", "flour", "paper-bag", "pothole", "puddle", "ramp", "shield", "truck", "van"]);
  }, 60_000);

  it("executes open paths in the real engine over 1000 seeds without relying on power-ups", () => {
    for (let n = 0; n < 1000; n++) {
      const run = perfectRun(`solvable${n}`, 1200);
      expect(run.over, `seed ${n}`).toBe(false);
      expect(run.collisions, `shield-independent seed ${n}`).toBe(0);
      expect(run.state.events.some((e) => e.type === "collision")).toBe(false);
    }
  }, 60_000);

  it("searches public snapshots for five-minute surviving paths across mature patterns", () => {
    for (let n = 0; n < 100; n++) {
      const run = perfectRun(`survive${n}`, 18001);
      expect(run.over, `seed ${n}`).toBe(false);
      expect(run.collisions, `shield-independent seed ${n}`).toBe(0);
    }
  }, 120_000);

  it("is deterministic and changes with the seed", () => {
    const a = createRunTrack("same"), b = createRunTrack("same"), c = createRunTrack("different");
    for (let i = 0; i < 10; i++) expect(a.next()).toEqual(b.next());
    expect(createRunTrack("same").next()).not.toEqual(c.next());
  });
});


it("requires roof use and keeps the snapshot search alive without power-ups", () => {
  for (let n = 0; n < 100; n++) {
    const seed = `reward${n}`;
    const ground = groundOnlyRun(seed, 18001), roof = perfectRun(seed, 18001);
    expect(ground.over, seed).toBe(true);
    expect(roof.peakY, seed).toBeGreaterThanOrEqual(2600);
    expect(roof.over, seed).toBe(false);
  }
}, 60000);

it("puts most mature bread on roofs, ends each van train with gold, and sometimes loads trucks", () => {
  let roof = 0, ground = 0, loaded = 0, trucks = 0;
  for (let seed = 0; seed < 20; seed++) {
    const track = createRunTrack(`roof-distribution${seed}`);
    for (let i = 0; i < 30; i++) {
      const { objects } = track.next();
      for (const van of objects.filter(o => o.kind === "van")) {
        const line = objects.filter(o => o.kind === "bread" && o.lane === van.lane && o.y === van.height && o.z > van.z - van.front && o.z < van.z + van.back);
        expect(line.length).toBeGreaterThanOrEqual(3);
        const followed = objects.some(o => o.kind === "van" && o.lane === van.lane && o.z - o.front === van.z + van.back);
        expect(line.filter(o => o.value === 5)).toHaveLength(followed ? 0 : 1);
        if (!followed) expect(line.at(-1)?.value).toBe(5);
        const street = objects.filter(o => o.kind === "bread" && o.y === 0 && o.z >= van.z - 18000 && o.z <= van.z + 8000);
        expect(street.length).toBeLessThanOrEqual(1);
      }
      for (const truck of objects.filter(o => o.kind === "truck")) {
        trucks++;
        if (objects.some(o => o.carrierId === truck.id)) loaded++;
      }
      if (i > 5) for (const bread of objects.filter(o => o.kind === "bread")) {
        if (bread.y) roof++; else ground++;
      }
    }
  }
  expect(roof).toBeGreaterThan(ground);
  expect(loaded).toBeGreaterThan(0);
  expect(loaded).toBeLessThan(trucks);
});
