import { describe, expect, it } from "vitest";
import {
  LANES, ROW_GAP, MAX_SPEED, MIN_REACTION_TICKS, MIN_REACTION_DISTANCE,
  LANE_CHANGE_TICKS, VISIBLE_DISTANCE, isRunObstacle,
} from "@/lib/run";
import { createRunTrack } from "@/lib/run/track";
import { perfectRun } from "../support/runBot";

describe("run track solvability", () => {
  it("preserves a reachable open path across chunks over 1000 seeds, including maximum coffee speed", () => {
    const kinds = new Set<string>();
    let twoLaneCrossings = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const track = createRunTrack(`solvable${seed}`);
      let lane = 1, previousZ = 0, previousId = -1;
      for (let index = 0; index < 12; index++) {
        const chunk = track.next();
        expect(chunk.index).toBe(index);
        expect(chunk.start).toBe(previousZ);
        expect(chunk.end - chunk.start).toBe(ROW_GAP * 3);
        expect(chunk.objects.every((o, i, all) => o.z > chunk.start && o.z <= chunk.end && (i === 0 || all[i - 1].z <= o.z))).toBe(true);
        const ids = chunk.objects.map((o) => o.id).sort((a, b) => a - b);
        expect(ids[0]).toBe(previousId + 1);
        expect(new Set(ids).size).toBe(ids.length);
        previousId = ids.at(-1)!;
        for (const o of chunk.objects) kinds.add(o.kind);
        const obstacles = chunk.objects.filter((o) => isRunObstacle(o.kind));
        const rows = [...new Set(obstacles.map((o) => o.z))];
        expect(rows).toHaveLength(3);
        for (const z of rows) {
          const blocked = obstacles.filter((o) => o.z === z).map((o) => o.lane);
          const open = LANES.filter((l) => !blocked.includes(l));
          expect(open).toHaveLength(1);
          const changes = Math.abs(open[0] - lane);
          if (changes === 2) twoLaneCrossings++;
          // An independent constructive reachability proof, with one full tick of margin.
          expect(z - previousZ).toBeGreaterThanOrEqual(MAX_SPEED * (MIN_REACTION_TICKS + changes * LANE_CHANGE_TICKS + 1));
          expect(z - previousZ - MAX_SPEED * changes * LANE_CHANGE_TICKS).toBeGreaterThanOrEqual(MIN_REACTION_DISTANCE);
          expect(VISIBLE_DISTANCE).toBeGreaterThanOrEqual(z - previousZ);
          previousZ = z; lane = open[0];
        }
      }
    }
    expect(twoLaneCrossings).toBeGreaterThan(1000);
    expect([...kinds].sort()).toEqual(["awning", "bread", "cart", "coffee", "flour", "paper-bag", "puddle"]);
  }, 15_000);

  it("executes open paths in the real engine over 1000 seeds without relying on power-ups", () => {
    for (let n = 0; n < 1000; n++) {
      const run = perfectRun(`solvable${n}`, 1200);
      expect(run.over, `seed ${n}`).toBe(false);
      expect(run.state.events.some((e) => e.type === "collision")).toBe(false);
    }
  }, 15_000);

  it("is deterministic and changes with the seed", () => {
    const a = createRunTrack("same"), b = createRunTrack("same"), c = createRunTrack("different");
    for (let i = 0; i < 10; i++) expect(a.next()).toEqual(b.next());
    expect(createRunTrack("same").next()).not.toEqual(c.next());
  });
});
