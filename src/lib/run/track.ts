import { runGeometry, TRUCK_SPEED } from "./geometry";
import { createRng } from "../game/rng";
import { LANES, ROW_GAP, type RunLane, type RunObject, type RunObstacleKind } from "./types";

export interface RunChunk { index: number; start: number; end: number; objects: RunObject[] }
const OBSTACLES: readonly RunObstacleKind[] = ["cart", "flour", "awning", "puddle", "pothole", "bread-wheel"];

/** Density starts early; the reserved route moves at most one lane.
 * Special phrases replace the empty lane with an action gate or ramped roof.
 */
export const TRACK_LEAD = 30_000;
export const TRUCK_START = 480_000;
export const PRESSURE_START = 360_000;
export const ROOF_START = 1_260_000;
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
      const start = TRACK_LEAD + index * ROW_GAP * 3;
      const objects: RunObject[] = [];
      for (let row = 1; row <= 3; row++) {
        const z = start + row * ROW_GAP;
        const hard = Math.min(1, Math.max(0, (z - 240_000) / 480_000));
        const choices = LANES.filter(l => Math.abs(l - previousOpen) <= 1);
        const drawnOpen = hard > 0 ? choices[rng.int(choices.length)] : LANES[rng.int(3)];
        // Later routes may change on every row, but never skip a lane.
        const open = drawnOpen;
        previousOpen = open;
        const add = (lane: typeof open, at: number, kind: RunObject["kind"], y = 0, length?: number) => {
          const shape = kind in runGeometry.obstacles ? runGeometry.obstacles[kind as RunObstacleKind] : { front: 0, back: 0, height: 0 };
          objects.push({ id: id++, lane, z: at, kind, front:shape.front,back:shape.back,height:shape.height, ...(length ? {front:length/2,back:length/2}:{}), y, speed: kind === "truck" ? TRUCK_SPEED : kind === "bread-wheel" ? runGeometry.breadWheelSpeed : 0 });
        };
        const roofOnly = z >= ROOF_START && index % 3 === 1;
        const wall = !roofOnly && z >= PRESSURE_START && (row === (index % 2 === 0 ? 3 : 2) || z >= 2_340_000);
        let hasVan = false;
        for (const lane of LANES) {
          if (lane === open && !roofOnly) continue;
          // Weighted library: ordinary pairs, ramp/van trains, and oncoming trucks.
          const roll = rng.int(100);
          let cumulative = 0;
          const drawnPattern = RUN_PATTERNS.find(p => {
            cumulative += p.friendly + (p.mature - p.friendly) * hard;
            return roll < cumulative;
          })!;
          // Trucks occur in the middle of a phrase; the surrounding rows
          // preserve the full static approach envelope after an action gate.
          const pattern = roofOnly ? (lane === open ? "van" : "street")
            : wall ? "street"
            : drawnPattern.kind === "truck" && (z < TRUCK_START || row !== 2) ? "van" : drawnPattern.kind;
          if (pattern === "van") {
            hasVan = true;
            const length = roofOnly ? 12000 : runGeometry.vanMinLength + runGeometry.vanLengthStep * rng.int(1 + (runGeometry.vanMaxLength - runGeometry.vanMinLength) / runGeometry.vanLengthStep);
            add(lane, z, "van", 0, length);
            add(lane, z - length / 2 - runGeometry.obstacles.ramp.back, "ramp");
            for (let offset = -length / 2 + runGeometry.roofBreadInset; offset < length / 2 - runGeometry.roofBreadInset; offset += runGeometry.roofBreadSpacing) add(lane, z + offset, "bread", runGeometry.obstacles.van.height);
            // Each separated ramp/van is a train; finish its roof line with gold.
            add(lane, z + length / 2 - runGeometry.roofBreadInset, "bread", runGeometry.obstacles.van.height);
            objects[objects.length - 1].value = 5;
            if (roofOnly) {
              delete objects[objects.length - 1].value;
              // Two touching roofs: one approach ramp, no ground route through
              // the flanking cart wall, and gold only at the train's far end.
              add(lane, z + 12_000, "van", 0, 12000);
              for (const offset of [8000, 11000, 14000, 16000]) add(lane, z + offset, "bread", 2600);
              objects[objects.length - 1].value = 5;
            }
          } else if (pattern === "truck") {
            add(lane, z, "truck");
            const truck = objects[objects.length - 1];
            // Shift only between the two blocked lanes: never invade the reserved route.
            const target = LANES.find(l => l !== open && Math.abs(l - lane) === 1);
            if (target !== undefined) truck.targetLane = target;
            const carrierId = truck.id;
            if (roll % 2 === 0) for (const offset of [-3000, 0, 3000]) {
              add(lane, z + offset, "bread", runGeometry.obstacles.truck.height);
              objects[objects.length - 1].carrierId = carrierId;
              objects[objects.length - 1].speed = TRUCK_SPEED;
            }
          }
          else {
            const kind = roofOnly || wall ? "cart" : OBSTACLES[rng.int(z < 240_000 ? 4 : OBSTACLES.length)];
            add(lane, z, kind === "bread-wheel" && (row !== 2 || z < TRUCK_START) ? "pothole" : kind);
          }
        }
        if (wall) {
          add(open, z, row % 2 === 0 ? "flour" : "awning");
          // Flour is followed by a lane-change blocker; awnings by a timed
          // pothole jump. A 26m combo gap also works at maximum coffee speed.
          add(open, z + (row % 2 === 1 ? 26_000 : 18_000), row % 2 === 1 ? "pothole" : "cart");
        }
        // A visible bread line leads into the open lane; the side loaves reward a bag.
        for (const offset of (hasVan || wall ? [12_000] : [18_000, 12_000, 6_000])) {
          add(open, z - offset, "bread");
        }
        const power = rng.int(96);
        // Side loaves accompany a magnet; the main line always names the safe
        // route. Roof lines begin after their approach ramp.
        if (hard === 0 && power === 0) for (const lane of LANES) {
          if (lane !== open) add(lane, z - 12_000, "bread");
        }
        if (hard > 0 && row === 3 && !hasVan && !wall) for (const offset of [0, -4_000, -8_000]) add(open, z - offset, "bread");
        if (power === 2 || power === 3) add(open, z - 24_000, power === 2 ? "double-jump-shoes" : "shield");
        if (power < 2 && hard === 0) add(open, z - 24_000, power === 0 ? "paper-bag" : "coffee");
      }
      objects.sort((a, b) => a.z - b.z || a.id - b.id);
      return { index: index++, start, end: start + ROW_GAP * 3, objects };
    },
  };
}
