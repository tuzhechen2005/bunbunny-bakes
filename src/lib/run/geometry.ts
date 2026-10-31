import geometry from "./geometry.json";
import type { RunObstacleKind, RunPlayer } from "./types";

/** Millimetres; Blender reads this same file when fitting obstacle meshes. */
export const runGeometry = geometry;
export const MAX_OBSTACLE_FRONT = Math.max(...Object.values(geometry.obstacles).map(o => o.front));
export const MAX_OBSTACLE_BACK = Math.max(...Object.values(geometry.obstacles).map(o => o.back));
/** Integer parabola, shared by replay and drawing (progress is 0..1000). */
export function jumpLift(progress: number): number {
  return Math.floor(4 * geometry.jumpHeight * progress * (1000 - progress) / 1_000_000);
}
export function slideBodyHeight(progress: number): number {
  const crouch = Math.min(1, progress / 180, (1000 - progress) / 180);
  return Math.round(geometry.standingHeight - crouch * (geometry.standingHeight - geometry.slideHeight));
}
export function clearsObstacle(kind: RunObstacleKind, pose: RunPlayer["pose"] | null, progress: number): boolean {
  if (kind === "cart") return false;
  if (kind === "awning") return pose === "slide" &&
    slideBodyHeight(progress) <= geometry.obstacles.awning.clearance + geometry.heightGrace;
  const height = geometry.obstacles[kind].height;
  const grace = Math.min(geometry.heightGrace, height / 4);
  return pose === "jump" && jumpLift(progress) + grace >= height;
}
/** Swept interval prevents fast movement skipping a narrow obstacle. */
export function overlapsObstacle(kind: RunObstacleKind, previousZ: number, z: number): boolean {
  const shape = geometry.obstacles[kind];
  return z <= shape.front - geometry.edgeGrace && previousZ >= -shape.back + geometry.edgeGrace;
}
/** Vertical world height at the player's contact plane; camera elevation is atan(3/4). */
export function worldHeightPixels(mm: number, height: number): number {
  return mm / geometry.focalDistance * height * (geometry.feet - geometry.horizon) * 4 / 3;
}

/** Linear contact zone keeps sprite origin and both depth edges on one plane at z=0.
 * The distant perspective joins with the same value and slope (no visual seam).
 */
export function projectionDepth(z: number): number {
  const { focalDistance: focal, contactZone: near } = geometry;
  return z <= near ? 1 - z / focal : (1 - near / focal) / (1 + (z - near) / (focal - near));
}
export function projectionZ(depth: number): number {
  const { focalDistance: focal, contactZone: near } = geometry;
  const join = 1 - near / focal;
  return depth >= join ? (1 - depth) * focal : near + (join / depth - 1) * (focal - near);
}
