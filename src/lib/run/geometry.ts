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
/** Level pinhole camera; height above the road fixes the vertical world scale. */
export function worldHeightPixels(mm: number, height: number): number {
  return mm / geometry.cameraHeight * height * (geometry.feet - geometry.horizon);
}
/** One continuous pinhole, including the short visible interval behind the feet. */
export function projectionDepth(z: number): number {
  return geometry.focalDistance / (geometry.focalDistance + z);
}
export function projectionZ(depth: number): number {
  return geometry.focalDistance * (1 / depth - 1);
}
