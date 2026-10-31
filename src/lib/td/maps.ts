import { SUBUNITS, type TdMap, type TdPoint } from "./types";

function map(name: string, path: number[][], slots: number[][]): TdMap {
  const points = (pairs: number[][]) => Object.freeze(pairs.map(([x, y]) => Object.freeze({ x, y })));
  return Object.freeze({ name, path: points(path), slots: points(slots) });
}

/** Original orthogonal bakery routes: integer arc lengths, no floating point geometry. */
export const TD_MAPS: readonly TdMap[] = Object.freeze([
  map("Cooling rack", [[0, 150], [1100, 150], [1100, 380], [180, 380], [180, 650], [1280, 650], [1280, 430]],
    [[160, 240], [400, 240], [650, 240], [900, 240], [1200, 240], [280, 490], [540, 550], [800, 550], [1050, 550], [90, 540], [1380, 540]]),
  map("Dough folds", [[0, 490], [240, 490], [240, 140], [700, 140], [700, 630], [980, 630], [980, 160], [1280, 160], [1280, 440]],
    [[140, 390], [340, 240], [550, 240], [600, 450], [340, 500], [800, 240], [870, 460], [800, 730], [1080, 540], [1130, 260], [1380, 330]]),
  map("Proofing walk", [[0, 150], [500, 150], [500, 410], [180, 410], [180, 660], [800, 660], [800, 150], [1120, 150], [1120, 620], [1300, 620]],
    [[140, 240], [350, 260], [600, 260], [90, 520], [290, 550], [540, 560], [700, 450], [900, 260], [1010, 460], [1220, 320], [1240, 510]]),
]);

/** Total arc length in movement subunits. */
export function pathLength(map: TdMap): number {
  return map.path.slice(1).reduce((sum, b, i) => {
    const a = map.path[i];
    return sum + (Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) * SUBUNITS;
  }, 0);
}

/** Clamp to the path and truncate only the rendered position, never movement progress. */
export function pathPosition(map: TdMap, distance: number): TdPoint {
  let remaining = Math.max(0, distance);
  for (let i = 1; i < map.path.length; i++) {
    const a = map.path[i - 1], b = map.path[i];
    const length = (Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) * SUBUNITS;
    if (remaining <= length) return {
      x: a.x + Math.sign(b.x - a.x) * Math.floor(remaining / SUBUNITS),
      y: a.y + Math.sign(b.y - a.y) * Math.floor(remaining / SUBUNITS),
    };
    remaining -= length;
  }
  return { ...map.path[map.path.length - 1] };
}

export const distanceSquared = (a: TdPoint, b: TdPoint): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Integer screen degrees, with reversed tangent for returning thieves. */
export function pathHeading(map: TdMap, distance: number, returning = false): number {
  let remaining = Math.max(0, distance);
  for (let i = 1; i < map.path.length; i++) {
    const a = map.path[i - 1], b = map.path[i];
    const length = (Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) * SUBUNITS;
    if (remaining <= length || i === map.path.length - 1) {
      const angle = b.x > a.x ? 0 : b.x < a.x ? 180 : b.y > a.y ? 90 : 270;
      return (angle + (returning ? 180 : 0)) % 360;
    }
    remaining -= length;
  }
  return 0;
}
