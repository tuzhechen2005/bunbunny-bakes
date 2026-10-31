import { runGeometry, TRUCK_SPEED } from "./geometry";
import { createRng } from "../game/rng";
import { LANES, ROW_GAP, type RunObject, type RunObstacleKind } from "./types";

export interface RunChunk { index: number; start: number; end: number; objects: RunObject[] }
const OBSTACLES: readonly RunObstacleKind[] = ["cart", "flour", "awning", "puddle"];

/** Weights interpolate by distance, reaching mature density at 1.4 km (~60 s).
 * Repeated roof patterns form van trains; every van has an approach ramp.
 * The reserved lane is at most one lane from the previous one after 600 m.
 * At maximum coffee speed even moving-truck envelopes leave a legal crossing.
 */
export const RUN_PATTERNS = [
  { kind: "van", friendly: 0, mature: 45 },
  { kind: "truck", friendly: 0, mature: 25 },
  { kind: "street", friendly: 100, mature: 30 },
] as const;

export function createRunTrack(seed: string): { next(): RunChunk } {
  const rng = createRng(`${seed}:run:track:v1`);
  let index = 0;
  let id = 0;
  let previousOpen = 1;
  return {
    next() {
      const start = index * ROW_GAP * 3;
      const objects: RunObject[] = [];
      for (let row = 1; row <= 3; row++) {
        const z = start + row * ROW_GAP;
        const hard = Math.min(1, Math.max(0, (z - 600_000) / 800_000));
        const choices = LANES.filter(l => Math.abs(l - previousOpen) <= 1);
        const open = hard > 0 ? choices[rng.int(choices.length)] : LANES[rng.int(3)];
        previousOpen = open;
        const add = (lane: typeof open, at: number, kind: RunObject["kind"], y = 0, length?: number) => {
          const shape = kind in runGeometry.obstacles ? runGeometry.obstacles[kind as RunObstacleKind] : { front: 0, back: 0, height: 0 };
          objects.push({ id: id++, lane, z: at, kind, front:shape.front,back:shape.back,height:shape.height, ...(length ? {front:length/2,back:length/2}:{}), y, ...(kind === "truck" ? {speed:TRUCK_SPEED}: {}) });
        };
        for (const lane of LANES) {
          if (lane === open) continue;
          // Weighted library: ordinary pairs, ramp/van trains, and oncoming trucks.
          const roll = rng.int(100);
          let cumulative = 0;
          const pattern = RUN_PATTERNS.find(p => {
            cumulative += p.friendly + (p.mature - p.friendly) * hard;
            return roll < cumulative;
          })!;
          if (pattern.kind === "van") {
            const length = runGeometry.vanMinLength + runGeometry.vanLengthStep * rng.int(1 + (runGeometry.vanMaxLength - runGeometry.vanMinLength) / runGeometry.vanLengthStep);
            add(lane, z, "van", 0, length);
            add(lane, z - length / 2 - runGeometry.obstacles.ramp.back, "ramp");
            for (let offset = -length / 2 + runGeometry.roofBreadInset; offset < length / 2; offset += runGeometry.roofBreadSpacing) add(lane, z + offset, "bread", runGeometry.obstacles.van.height);
          } else if (pattern.kind === "truck") add(lane, z, "truck");
          else add(lane, z, OBSTACLES[rng.int(4)]);
        }
        // A visible bread line leads into the open lane; the side loaves reward a bag.
        for (const offset of [18_000, 12_000, 6_000]) {
          add(open, z - offset, "bread");
        }
        for (const lane of LANES) {
          if (lane !== open) add(lane, z - 12_000, "bread");
        }
        const power = rng.int(24);
        if (power < 2 && hard === 0) add(open, z - 24_000, power === 0 ? "paper-bag" : "coffee");
      }
      objects.sort((a, b) => a.z - b.z || a.id - b.id);
      return { index: index++, start, end: start + ROW_GAP * 3, objects };
    },
  };
}
