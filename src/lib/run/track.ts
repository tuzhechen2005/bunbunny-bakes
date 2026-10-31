import { createRng } from "../game/rng";
import { LANES, ROW_GAP, type RunObject, type RunObstacleKind } from "./types";

export interface RunChunk { index: number; start: number; end: number; objects: RunObject[] }
const OBSTACLES: readonly RunObstacleKind[] = ["cart", "flour", "awning", "puddle"];

/** Three obstacle rows per chunk, each with one completely open lane.
 * Even at MAX_SPEED, adjacent rows allow MIN_REACTION_TICKS + two lane changes.
 * The same bound holds across chunk boundaries and when coffee starts/expires.
 * Generation depends only on seed and chunk index, never rendering/step cadence.
 */
export function createRunTrack(seed: string): { next(): RunChunk } {
  const rng = createRng(`${seed}:run:track:v1`);
  let index = 0;
  let id = 0;
  return {
    next() {
      const start = index * ROW_GAP * 3;
      const objects: RunObject[] = [];
      for (let row = 1; row <= 3; row++) {
        const z = start + row * ROW_GAP;
        const open = LANES[rng.int(3)];
        for (const lane of LANES) {
          if (lane !== open) objects.push({ id: id++, lane, z, kind: OBSTACLES[rng.int(4)] });
        }
        // A visible bread line leads into the open lane; the side loaves reward a bag.
        for (const offset of [18_000, 12_000, 6_000]) {
          objects.push({ id: id++, lane: open, z: z - offset, kind: "bread" });
        }
        for (const lane of LANES) {
          if (lane !== open) objects.push({ id: id++, lane, z: z - 12_000, kind: "bread" });
        }
        const power = rng.int(24);
        if (power < 2) objects.push({ id: id++, lane: open, z: z - 24_000, kind: power === 0 ? "paper-bag" : "coffee" });
      }
      objects.sort((a, b) => a.z - b.z || a.id - b.id);
      return { index: index++, start, end: start + ROW_GAP * 3, objects };
    },
  };
}
