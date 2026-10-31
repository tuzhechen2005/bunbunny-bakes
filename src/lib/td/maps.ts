import { SUBUNITS, type TdMap, type TdPoint } from "./types";

function map(name: string, path: number[][], slots: number[][]): TdMap {
  const points = (pairs: number[][]) => Object.freeze(pairs.map(([x, y]) => Object.freeze({ x, y })));
  return Object.freeze({ name, path: points(path), slots: points(slots) });
}

/** Original orthogonal bakery routes: integer arc lengths, no floating point geometry. */
export const TD_MAPS: readonly TdMap[] = Object.freeze([
  map("Cooling rack", [[0, 140], [600, 140], [600, 400], [120, 400], [120, 680], [600, 680], [600, 960], [360, 960], [360, 1080]],
    [[160, 230], [440, 230], [660, 520], [210, 530], [440, 590], [510, 790], [270, 890]]),
  map("Dough folds", [[120, 0], [120, 300], [580, 300], [580, 560], [140, 560], [140, 850], [580, 850], [580, 1080]],
    [[210, 160], [430, 210], [490, 420], [660, 650], [230, 650], [380, 760], [490, 960]]),
  map("Proofing walk", [[0, 180], [500, 180], [500, 420], [240, 420], [240, 700], [620, 700], [620, 960], [120, 960], [120, 1080]],
    [[140, 270], [340, 270], [590, 320], [150, 580], [430, 610], [530, 830], [210, 870]]),
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
