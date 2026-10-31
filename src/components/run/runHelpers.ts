import { runGeometry, projectionDepth } from "@/lib/run/geometry";
import type { RunDirection } from "@/lib/run";
/** Lock one direction per touch gesture once the finger moves ten CSS pixels. */
export function swipeDirection(dx: number, dy: number): RunDirection | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return null;
  return Math.abs(dx) > Math.abs(dy) ? dx < 0 ? "L" : "R" : dy < 0 ? "U" : "D";
}
/** Ground coordinates: the vanishing point sits at 33%, player contact at 86%. */
export function project(lane: number, z: number, width: number, height: number) {
  const depth = projectionDepth(z);
  return { x: width / 2 + (lane - 1) * width * .27 * depth,
    y: height * (runGeometry.horizon + (runGeometry.feet - runGeometry.horizon) * depth), scale: width / 390 * depth };
}
