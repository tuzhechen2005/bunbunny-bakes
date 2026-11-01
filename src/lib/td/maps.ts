import { SUBUNITS, type TdMap, type TdPoint } from "./types";

function map(name: string, path: number[][], slots: number[][]): TdMap {
  const points = (pairs: number[][]) => Object.freeze(pairs.map(([x, y]) => Object.freeze({ x, y })));
  return Object.freeze({ name, path: points(path), slots: points(slots) });
}

/** Rounded vertical serpentines; baked art reads these literal integer vertices. */
export const TD_MAPS: readonly TdMap[] = Object.freeze([
  map("Cooling rack", [[180, 0], [180, 670], [181, 684], [185, 697], [192, 709], [201, 719], [211, 728], [223, 735], [236, 739], [250, 740], [630, 740], [644, 739], [657, 735], [669, 728], [679, 719], [688, 709], [695, 697], [699, 684], [700, 670], [700, 140], [701, 126], [705, 113], [712, 101], [721, 91], [731, 82], [743, 75], [756, 71], [770, 70], [1150, 70], [1164, 71], [1177, 75], [1189, 82], [1199, 91], [1208, 101], [1215, 113], [1219, 126], [1220, 140], [1220, 690]],
    [[310, 210], [310, 340], [310, 470], [310, 600], [570, 260], [830, 210], [830, 340], [830, 470], [830, 600], [1090, 260], [1090, 530]]),
  map("Dough folds", [[120, 0], [120, 670], [121, 684], [125, 697], [132, 709], [141, 719], [151, 728], [163, 735], [176, 739], [190, 740], [440, 740], [454, 739], [467, 735], [479, 728], [489, 719], [498, 709], [505, 697], [509, 684], [510, 670], [510, 140], [511, 126], [515, 113], [522, 101], [531, 91], [541, 82], [553, 75], [566, 71], [580, 70], [830, 70], [844, 71], [857, 75], [869, 82], [879, 91], [888, 101], [895, 113], [899, 126], [900, 140], [900, 670], [901, 684], [905, 697], [912, 709], [921, 719], [931, 728], [943, 735], [956, 739], [970, 740], [1220, 740], [1234, 739], [1247, 735], [1259, 728], [1269, 719], [1278, 709], [1285, 697], [1289, 684], [1290, 670], [1290, 120]],
    [[250, 240], [250, 400], [250, 560], [640, 240], [640, 400], [640, 560], [1030, 240], [1030, 400], [1030, 560], [1160, 240], [1160, 400]]),
  map("Proofing walk", [[100, 0], [100, 670], [101, 684], [105, 697], [112, 709], [121, 719], [131, 728], [143, 735], [156, 739], [170, 740], [320, 740], [334, 739], [347, 735], [359, 728], [369, 719], [378, 709], [385, 697], [389, 684], [390, 670], [390, 140], [391, 126], [395, 113], [402, 101], [411, 91], [421, 82], [433, 75], [446, 71], [460, 70], [610, 70], [624, 71], [637, 75], [649, 82], [659, 91], [668, 101], [675, 113], [679, 126], [680, 140], [680, 685], [681, 696], [684, 706], [689, 716], [696, 724], [704, 731], [714, 736], [724, 739], [735, 740], [915, 740], [926, 739], [936, 736], [946, 731], [954, 724], [961, 716], [966, 706], [969, 696], [970, 685], [970, 140], [971, 126], [975, 113], [982, 101], [991, 91], [1001, 82], [1013, 75], [1026, 71], [1040, 70], [1190, 70], [1204, 71], [1217, 75], [1229, 82], [1239, 91], [1248, 101], [1255, 113], [1259, 126], [1260, 140], [1260, 690]],
    [[245, 230], [245, 400], [245, 570], [535, 230], [535, 400], [535, 570], [825, 230], [825, 400], [825, 570], [1115, 280], [1115, 530]]),
]);

// Quantize each Euclidean segment once to integer movement subunits. Shared by
// length, interpolation and heading so replay never accumulates fractional travel.
const geometry = new WeakMap<TdMap, { lengths: number[]; total: number }>();
function segments(map: TdMap) {
  let cached = geometry.get(map);
  if (!cached) {
    const lengths = map.path.slice(1).map((b, i) => Math.round(Math.hypot(b.x-map.path[i].x, b.y-map.path[i].y) * SUBUNITS));
    cached = { lengths, total: lengths.reduce((a,b) => a+b, 0) };
    geometry.set(map, cached);
  }
  return cached;
}

export function pathLength(map: TdMap): number { return segments(map).total; }

/** Clamp progress and interpolate on the same rounded polyline used by Blender. */
export function pathPosition(map: TdMap, distance: number): TdPoint {
  let remaining = Math.max(0, distance);
  const { lengths } = segments(map);
  for (let i = 1; i < map.path.length; i++) {
    const a = map.path[i-1], b = map.path[i], length = lengths[i-1];
    if (remaining <= length) return {
      x: a.x + Math.trunc((b.x-a.x) * remaining / length),
      y: a.y + Math.trunc((b.y-a.y) * remaining / length),
    };
    remaining -= length;
  }
  return { ...map.path[map.path.length-1] };
}

export const distanceSquared = (a: TdPoint, b: TdPoint): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Integer screen degrees, with reversed tangent for returning thieves. */
export function pathHeading(map: TdMap, distance: number, returning = false): number {
  let remaining = Math.max(0, distance);
  const { lengths } = segments(map);
  for (let i = 1; i < map.path.length; i++) {
    const a = map.path[i-1], b = map.path[i];
    if (remaining <= lengths[i-1] || i === map.path.length-1) {
      const angle = Math.round(Math.atan2(b.y-a.y, b.x-a.x) * 180 / Math.PI);
      return (angle + 360 + (returning ? 180 : 0)) % 360;
    }
    remaining -= lengths[i-1];
  }
  return 0;
}
