import { createRng } from "../game/rng";
import { SUBUNITS, type TdMap, type TdPoint, type TdFeature } from "./types";

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

/** Each lesson has its own literal silhouette. Feature distances are subunits. */
const LESSONS: [string, number[][], number[][]][] = [
  ["Gentle S",[[80,330],[400,330],[520,450],[850,450],[970,330],[1340,330]],[[560,290],[800,285],[370,415]]],
  ["Bomb bowl",[[80,180],[420,180],[420,570],[900,570],[900,300],[1340,300]],[[320,290],[530,440],[800,470]]],
  ["Flour corridor",[[80,140],[250,140],[250,650],[690,650],[690,160],[1150,160],[1150,600],[1340,600]],[[800,290],[1040,290],[350,530],[560,530]]],
  ["Fast straight",[[80,240],[520,240],[520,610],[970,610],[970,240],[1340,240]],[[650,500],[1100,350],[410,350],[860,500]]],
  ["Whisk bend",[[80,150],[300,150],[300,650],[640,650],[640,180],[1030,180],[1030,620],[1340,620]],[[200,260],[410,530],[770,290],[920,290],[1130,500]]],
  ["Bell staircase",[[80,140],[360,140],[360,370],[650,370],[650,660],[1040,660],[1040,300],[1340,300]],[[470,260],[770,560],[1160,410],[230,230],[530,470]]],
  ["Twin lanes",[[80,400],[440,400],[800,400],[1060,400],[1060,650],[1340,650]],[[950,500],[1160,530],[230,500],[410,500],[770,500],[200,290]]],
  ["Oven reach",[[80,130],[210,130],[210,660],[600,660],[600,160],[1000,160],[1000,630],[1340,630]],[[320,560],[500,560],[710,290],[890,290],[1100,500],[500,260]]],
  ["Switch lesson",[[80,360],[450,360],[810,360],[1060,360],[1060,150],[1340,150]],[[950,260],[1190,260],[230,260],[410,260],[770,260],[200,470],[380,470]]],
  ["Butter return",[[80,160],[290,160],[290,650],[680,650],[680,190],[1110,190],[1110,610],[1340,610]],[[560,530],[800,290],[980,290],[410,560],[1220,500],[170,260],[590,290]]],
];

export function slotCount(level: number): number { return Math.min(11, 3 + Math.floor((level - 1) / 2)); }

/** Constructive generation: monotone columns cannot cross; no rejection loop. */
const levelMaps = new Map<string, TdMap>();
export function levelMap(seed: string, level: number): TdMap {
  const key = `${seed}:${level}`;
  const cached = levelMaps.get(key);
  if (cached) return structuredClone(cached);
  const result = buildLevelMap(seed,level);
  if (levelMaps.size >= 64) levelMaps.delete(levelMaps.keys().next().value!);
  levelMaps.set(key,result);
  return structuredClone(result);
}
function buildLevelMap(seed: string, level: number): TdMap {
  const rng = createRng(`${seed}:map`);
  let name: string, pairs: number[][];
  if (level <= 10) [name, pairs] = LESSONS[level - 1];
  else {
    name = `Bakery route ${level}`;
    const columns = 3 + rng.int(3), gap = Math.floor(1120 / (columns - 1));
    pairs = [[60, 130]];
    for (let i = 0; i < columns; i++) {
      const x = 160 + i * gap;
      const top = 100 + rng.int(70), bottom = 630 + rng.int(70);
      pairs.push([x, i % 2 ? bottom : top], [x, i % 2 ? top : bottom]);
    }
    pairs.push([1370, pairs.at(-1)![1]]);
  }
  const path = pairs.map(([x,y]) => ({ x,y }));
  const bare: TdMap = { name, path, slots: [] };
  const total = pathLength(bare);
  // Select useful grid positions with clearance and spacing, ordered by path coverage.
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let y = level <= 10 ? 811 : 110; y <= 700; y += 30) for (let x = 110; x <= 1300; x += 30) {
    let nearest = Infinity, score = 0;
    for (let d = 0; d <= total; d += 20 * SUBUNITS) {
      const dist = distanceSquared({x,y}, pathPosition(bare,d));
      nearest = Math.min(nearest, dist);
      if (dist <= 165 ** 2) score++;
    }
    if (nearest >= 85 ** 2 && nearest <= 150 ** 2) candidates.push({x,y,score});
  }
  candidates.sort((a,b) => b.score-a.score || a.x-b.x || a.y-b.y);
  const slots: TdPoint[] = level <= 10 ? LESSONS[level-1][2].map(([x,y])=>({x,y})) : [];
  const features: TdFeature[] = [];
  const add = (type: TdFeature['type'], from: number, to: number) => {
    const start = Math.floor(total * from / 100), end = Math.floor(total * to / 100);
    const geometry = [pathPosition(bare,start)];
    for (let d = start + 20 * SUBUNITS; d < end; d += 20 * SUBUNITS) geometry.push(pathPosition(bare,d));
    geometry.push(pathPosition(bare,end));
    features.push({id:features.length,type,start,end,geometry});
  };
  if (level >= 4) add('strip', 12, 18);
  if (level >= 7) {
    // Fork on one straight segment. Both branches share endpoints and have equal lengths.
    const index = 1;
    const a = path[index], b = path[index+1];
    const start = pathLength({ ...bare, path: path.slice(0,index+1) });
    const end = start + Math.round(Math.hypot(b.x-a.x,b.y-a.y)*SUBUNITS);
    const horizontal = a.y === b.y;
    const offset = 60;
    const branches = [-1,1].map(sign => [a,
      { x: Math.round(a.x+(b.x-a.x)/3)+(horizontal?0:offset*sign), y: Math.round(a.y+(b.y-a.y)/3)+(horizontal?offset*sign:0) },
      { x: Math.round(a.x+2*(b.x-a.x)/3)+(horizontal?0:offset*sign), y: Math.round(a.y+2*(b.y-a.y)/3)+(horizontal?offset*sign:0) }, b]);
    features.push({id:features.length,type:'fork',start,end,geometry:[a,b],branches,switchable:level>=9});
  }
  if (level >= 12) add('jam', 55, 61);
  if (level >= 15) add('portal', 70, 78);
  if (level >= 17) add('tunnel', 85, 90);
  for (let i = 0; i < Math.min(4, Math.floor((level-19)/4)); i++) add(i%2 ? 'jam':'strip', 24+i*6, 27+i*6);
  for (const p of candidates) if (slots.every(s => distanceSquared(s,p) >= 126 ** 2) && features.every(f => !f.branches || f.branches.every(branch => branch.slice(1).every((b,i) => {
    const a = branch[i], dx=b.x-a.x, dy=b.y-a.y;
    const t = Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy)));
    return distanceSquared(p,{x:a.x+t*dx,y:a.y+t*dy}) >= 65**2;
  })))) {
    slots.push({x:p.x,y:p.y});
    if (slots.length === slotCount(level)) break;
  }
  if (slots.length !== slotCount(level)) throw new Error('td: map has insufficient useful slots');
  const result = {name,path,slots,features};
  for (const f of features) if (f.type !== 'fork') {
    const fork = features.find(other => other.type === 'fork' && other.start < f.end && other.end > f.start);
    if (fork) {
      f.geometries = [0,1].map(branch => f.geometry.map((_,i) => {
        const d = i === f.geometry.length-1 ? f.end : f.start+i*20*SUBUNITS;
        const route = pestRoute(result,d,{[fork.id]:branch});
        return pathPosition(route.map,route.distance);
      }));
      f.geometry = f.geometries[0];
    }
  }
  return result;
}

/** Fork travel keeps integer canonical progress; branch length scales movement. */
const branchMaps = new WeakMap<readonly TdPoint[], TdMap>();
export function pestRoute(map: TdMap, distance: number, choices: Record<number, number>): { map: TdMap; distance: number; scale: number } {
  const fork = map.features?.find(f => f.type === 'fork' && distance >= f.start && distance <= f.end && choices[f.id] !== undefined);
  if (!fork?.branches) return {map,distance,scale:1000};
  const points = fork.branches[choices[fork.id]];
  let branch = branchMaps.get(points);
  if (!branch) { branch = {name:map.name,slots:[],path:points}; branchMaps.set(points,branch); }
  const length = pathLength(branch);
  return {map:branch,distance:Math.floor((distance-fork.start)*length/(fork.end-fork.start)),scale:Math.floor((fork.end-fork.start)*1000/length)};
}
