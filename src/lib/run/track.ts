import { runGeometry, TRUCK_SPEED } from "./geometry";
import { createRng } from "../game/rng";
import { LANES, ROW_GAP, type RunLane, type RunObject, type RunObstacleKind } from "./types";

export interface RunChunk { index: number; start: number; end: number; objects: RunObject[] }
const OBSTACLES: readonly RunObstacleKind[] = ["cart", "flour", "awning", "puddle"];

/** Weights interpolate by distance, reaching mature density at 850 m (~30 s).
 * Repeated roof patterns form van trains; every van has an approach ramp.
 * The reserved lane is at most one lane from the previous one after 550 m.
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
  let previousOpen: RunLane = 1;
  return {
    next() {
      const start = index * ROW_GAP * 3;
      const objects: RunObject[] = [];
      for (let row = 1; row <= 3; row++) {
        const z = start + row * ROW_GAP;
        const hard = Math.min(1, Math.max(0, (z - 550_000) / 300_000));
        const choices = LANES.filter(l => Math.abs(l - previousOpen) <= 1);
        const drawnOpen = hard > 0 ? choices[rng.int(choices.length)] : LANES[rng.int(3)];
        // Each mature phrase: hold a readable approach, move one lane in the
        // burst, then hold the exit for the reward. Never reverse twice blindly.
        const open = hard > 0 && row === 3 ? previousOpen : drawnOpen;
        previousOpen = open;
        const add = (lane: typeof open, at: number, kind: RunObject["kind"], y = 0, length?: number) => {
          const shape = kind in runGeometry.obstacles ? runGeometry.obstacles[kind as RunObstacleKind] : { front: 0, back: 0, height: 0 };
          objects.push({ id: id++, lane, z: at, kind, front:shape.front,back:shape.back,height:shape.height, ...(length ? {front:length/2,back:length/2}:{}), y, ...(kind === "truck" ? {speed:TRUCK_SPEED}: {}) });
        };
        let hasVan = false;
        for (const lane of LANES) {
          if (lane === open) continue;
          // Weighted library: ordinary pairs, ramp/van trains, and oncoming trucks.
          const roll = rng.int(100);
          let cumulative = 0;
          const drawnPattern = RUN_PATTERNS.find(p => {
            cumulative += p.friendly + (p.mature - p.friendly) * hard;
            return roll < cumulative;
          })!;
          // A calm street approach introduces the phrase. The burst may have
          // trucks; the exit uses ramped vans, never a surprise oncoming truck.
          const pattern = hard > 0 && row === 1 && index % 2 === 0 ? "street"
            : row === 3 && drawnPattern.kind === "truck" ? "van" : drawnPattern.kind;
          if (pattern === "van") {
            hasVan = true;
            const length = runGeometry.vanMinLength + runGeometry.vanLengthStep * rng.int(1 + (runGeometry.vanMaxLength - runGeometry.vanMinLength) / runGeometry.vanLengthStep);
            add(lane, z, "van", 0, length);
            add(lane, z - length / 2 - runGeometry.obstacles.ramp.back, "ramp");
            for (let offset = -length / 2 + runGeometry.roofBreadInset; offset < length / 2 - runGeometry.roofBreadInset; offset += runGeometry.roofBreadSpacing) add(lane, z + offset, "bread", runGeometry.obstacles.van.height);
            // Each separated ramp/van is a train; finish its roof line with gold.
            add(lane, z + length / 2 - runGeometry.roofBreadInset, "bread", runGeometry.obstacles.van.height);
            objects[objects.length - 1].value = 5;
          } else if (pattern === "truck") {
            add(lane, z, "truck");
            const carrierId = objects[objects.length - 1].id;
            if (roll % 2 === 0) for (const offset of [-3000, 0, 3000]) {
              add(lane, z + offset, "bread", runGeometry.obstacles.truck.height);
              objects[objects.length - 1].carrierId = carrierId;
              objects[objects.length - 1].speed = TRUCK_SPEED;
            }
          }
          else add(lane, z, OBSTACLES[rng.int(4)]);
        }
        // A visible bread line leads into the open lane; the side loaves reward a bag.
        for (const offset of (hasVan ? [12_000] : [18_000, 12_000, 6_000])) {
          add(open, z - offset, "bread");
        }
        const power = rng.int(24);
        // Side loaves accompany a magnet; the main line always names the safe
        // route. Roof lines begin after their approach ramp.
        if (hard === 0 && power === 0) for (const lane of LANES) {
          if (lane !== open) add(lane, z - 12_000, "bread");
        }
        if (hard > 0 && row === 3 && !hasVan) for (const offset of [0, -4_000, -8_000]) add(open, z - offset, "bread");
        if (power < 2 && hard === 0) add(open, z - 24_000, power === 0 ? "paper-bag" : "coffee");
      }
      objects.sort((a, b) => a.z - b.z || a.id - b.id);
      return { index: index++, start, end: start + ROW_GAP * 3, objects };
    },
  };
}
