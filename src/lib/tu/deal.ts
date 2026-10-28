// 兔了个兔 batch (炉) generator: lays out a layered board and assigns bread tiers so that a
// clearing order exists that never fills the 6-slot bag (D122).
//
// Construction in reverse: first the layout (positions only), then a random order in which the
// positions can be taken (each one free when its turn comes), then tiers along that order in
// triples, with a few triples "open" at once so the witness order interleaves them. The witness
// order is returned so tests can replay it through the real engine.
//
// Integer maths and the seeded Rng only: identical on server and client.

import { createRng, type Rng } from "../game/rng";

/** Board extent in tile units: tiles are 1 x 1, x in [0, BOARD_W - 1], y in [0, BOARD_H - 1]. */
export const BOARD_W = 7;
export const BOARD_H = 8;
export const BAG_SIZE = 6;

export interface BatchSpec {
  /** Distinct bread tiers on the board (capped at the shop's tier count). */
  tiers: number;
  layers: number;
  /** Multiple of 3. */
  tiles: number;
  /** Most triples "open" at once in the witness order (more = the triples are spread wider). */
  spread: number;
}

/**
 * Batch n uses BATCHES[n - 1]; every batch after the last repeats the last one. The curve (D128):
 * batches 1-2 are a warm-up (few breads, shallow, little hidden), batch 3 is the wall (all 8
 * breads, 5 layers, ~40% of the tiles hidden under others, triples spread wide).
 */
export const BATCHES: readonly BatchSpec[] = [
  { tiers: 4, layers: 2, tiles: 24, spread: 2 },
  { tiers: 4, layers: 2, tiles: 30, spread: 2 },
  { tiers: 8, layers: 5, tiles: 72, spread: 4 },
  { tiers: 8, layers: 6, tiles: 84, spread: 4 },
  { tiers: 8, layers: 6, tiles: 90, spread: 4 },
];

// Tuning guard: `spread` must stay 1-4 (= BAG_SIZE - 2). With 5 open triples of one tile each the
// witness bag holds 5, and the next tile can neither open a triple (the bag would fill) nor complete
// one, so assignTiers would have no legal tier and a batch would no longer be solvable by construction.
for (const b of BATCHES) {
  if (!(b.spread >= 1 && b.spread <= BAG_SIZE - 2) || b.tiles % 3 !== 0) throw new Error("tu: bad BATCHES entry");
}

export function batchSpec(batch: number): BatchSpec {
  return BATCHES[Math.min(batch, BATCHES.length) - 1];
}

/** A tile as dealt. `x2`/`y2` are doubled coordinates (integers); `pos` is the tile's index in the batch. */
export interface DealtTile {
  tier: number;
  x2: number;
  y2: number;
  layer: number;
}

export interface Batch {
  tiles: DealtTile[];
  /** Indexes into `tiles`: a clearing order that never fills the bag (the generator's witness). */
  solution: number[];
}

/** Two tiles overlap when their 1 x 1 squares share area (doubled coords: distance < 2 on both axes). */
export function overlaps(a: { x2: number; y2: number }, b: { x2: number; y2: number }): boolean {
  return Math.abs(a.x2 - b.x2) < 2 && Math.abs(a.y2 - b.y2) < 2;
}

/**
 * Hidden = every one of the tile's four half-unit quarters lies under some tile on a higher layer
 * (all coordinates are half-units, so a tile covers whole quarters; integer test, D128).
 */
export function isHidden(
  t: { x2: number; y2: number; layer: number },
  board: readonly { x2: number; y2: number; layer: number }[],
): boolean {
  let covered = 0; // bit per quarter
  for (const o of board) {
    if (o.layer <= t.layer || !overlaps(t, o)) continue;
    for (let q = 0; q < 4; q++) {
      const cx = t.x2 + (q & 1);
      const cy = t.y2 + (q >> 1);
      if (o.x2 <= cx && cx < o.x2 + 2 && o.y2 <= cy && cy < o.y2 + 2) covered |= 1 << q;
    }
    if (covered === 15) return true;
  }
  return false;
}

function shuffle<T>(rng: Rng, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** Tile counts per layer, bottom first: weights L, L-1, ..., 1; remainder to the bottom layers. */
function layerCounts(total: number, layers: number): number[] {
  const wsum = (layers * (layers + 1)) / 2;
  const counts = Array.from({ length: layers }, (_, l) => Math.floor((total * (layers - l)) / wsum));
  let rest = total - counts.reduce((s, c) => s + c, 0);
  for (let l = 0; rest > 0; l = (l + 1) % layers, rest--) counts[l]++;
  return counts;
}

const MIRROR = 2 * BOARD_W - 2; // x2 -> MIRROR - x2 mirrors the board left/right

function layout(rng: Rng, spec: BatchSpec): Omit<DealtTile, "tier">[] {
  const counts = layerCounts(spec.tiles, spec.layers);
  const placed: Omit<DealtTile, "tier">[] = [];
  let below: Omit<DealtTile, "tier">[] = [];
  const cx2 = MIRROR / 2;
  const cy2 = BOARD_H - 1;
  for (let l = 0; l < spec.layers; l++) {
    // Even layers sit on the grid; odd layers are shifted by half a tile (both axes, or one).
    const shift = l % 2 === 0 ? [0, 0] : [[1, 1], [1, 0], [0, 1]][rng.int(3)];
    const [ox, oy] = shift;
    const cells: { x2: number; y2: number; score: number }[] = [];
    const jitter = new Map<string, number>();
    for (let x2 = ox; x2 + 2 <= 2 * BOARD_W; x2 += 2) {
      for (let y2 = oy; y2 + 2 <= 2 * BOARD_H; y2 += 2) {
        const support = l === 0 ? 1 : below.filter((b) => overlaps(b, { x2, y2 })).length;
        if (support === 0) continue;
        const key = `${Math.min(x2, MIRROR - x2)},${y2}`;
        if (!jitter.has(key)) jitter.set(key, rng.int(24));
        const dx = x2 - cx2;
        const dy = y2 - cy2;
        cells.push({ x2, y2, score: dx * dx + dy * dy + (jitter.get(key) as number) - 6 * support });
      }
    }
    cells.sort((a, b) => a.score - b.score || a.y2 - b.y2 || a.x2 - b.x2);
    const taken = new Set<string>();
    const layer: Omit<DealtTile, "tier">[] = [];
    let need = counts[l];
    const take = (x2: number, y2: number) => {
      taken.add(`${x2},${y2}`);
      layer.push({ x2, y2, layer: l });
      need--;
    };
    // Mirrored pairs first (a calm, symmetric pile), a single centre cell when the count is odd.
    for (const c of cells) {
      if (need < 2) break;
      const m = MIRROR - c.x2;
      if (m === c.x2 || taken.has(`${c.x2},${c.y2}`)) continue;
      if (!cells.some((o) => o.x2 === m && o.y2 === c.y2) || taken.has(`${m},${c.y2}`)) continue;
      take(c.x2, c.y2);
      take(m, c.y2);
    }
    const centreFirst = [...cells.filter((c) => c.x2 === MIRROR - c.x2), ...cells];
    for (const c of centreFirst) {
      if (need === 0) break;
      if (!taken.has(`${c.x2},${c.y2}`)) take(c.x2, c.y2);
    }
    if (need > 0) throw new Error("tu: layout does not fit the board");
    placed.push(...layer);
    below = layer;
  }
  return placed;
}

/** A random order in which every position is free (nothing above it left) when it is taken. */
function removalOrder(rng: Rng, pos: Omit<DealtTile, "tier">[]): number[] {
  // above[i] = how many tiles still on the board cover i; coverers[j] = tiles that j covers.
  const above = pos.map(() => 0);
  const covers: number[][] = pos.map(() => []);
  pos.forEach((p, i) =>
    pos.forEach((q, j) => {
      if (q.layer > p.layer && overlaps(p, q)) {
        above[i]++;
        covers[j].push(i);
      }
    }),
  );
  const free = pos.map((_, i) => i).filter((i) => above[i] === 0);
  const order: number[] = [];
  while (free.length > 0) {
    const k = rng.int(free.length);
    const pick = free[k];
    free.splice(k, 1);
    order.push(pick);
    for (const i of covers[pick]) if (--above[i] === 0) free.push(i);
  }
  return order;
}

/**
 * Tiers along the witness order in triples. Up to `spread` triples are open at once, each open
 * triple has its own tier, and the bag in the witness never reaches 6 without a pack.
 */
function assignTiers(rng: Rng, n: number, spec: BatchSpec, tierPool: number[]): number[] {
  const triples = n / 3;
  const k = tierPool.length;
  // Triples per tier: as even as possible, the extra ones to random tiers.
  const quota = new Map<number, number>();
  const extra = shuffle(rng, [...tierPool]);
  tierPool.forEach((t) => quota.set(t, Math.floor(triples / k)));
  for (let i = 0; i < triples % k; i++) quota.set(extra[i], (quota.get(extra[i]) as number) + 1);

  const open = new Map<number, number>(); // tier -> tiles taken so far (1 or 2)
  const out: number[] = [];
  for (let p = 0; p < n; p++) {
    const rest = n - p - 1;
    const bag = [...open.values()].reduce((s, c) => s + c, 0);
    const need = [...open.values()].reduce((s, c) => s + 3 - c, 0);
    const fresh = tierPool.filter((t) => !open.has(t) && (quota.get(t) as number) > 0);
    const canOpen = fresh.length > 0 && open.size < spec.spread && bag + 1 < BAG_SIZE && rest >= need + 2;
    let tier: number;
    if (canOpen && (open.size === 0 || rng.int(2) === 0)) {
      let r = rng.int(fresh.reduce((s, t) => s + (quota.get(t) as number), 0));
      tier = fresh[0];
      for (const t of fresh) {
        r -= quota.get(t) as number;
        if (r < 0) {
          tier = t;
          break;
        }
      }
      quota.set(tier, (quota.get(tier) as number) - 1);
      open.set(tier, 1);
    } else {
      // Join an open triple; when the bag would hit 6 without a pack, it must be one that completes.
      const opts = [...open.keys()].filter((t) => bag + 1 < BAG_SIZE || open.get(t) === 2);
      tier = opts[rng.int(opts.length)];
      const c = (open.get(tier) as number) + 1;
      if (c === 3) open.delete(tier);
      else open.set(tier, c);
    }
    out.push(tier);
  }
  return out;
}

/**
 * Deals batch `batch` (1-based) for a game over `tierCount` tiers. Deterministic in (seed, batch).
 * The board uses the first k tiers of a seeded shuffle of 0..tierCount-1.
 */
export function dealBatch(seed: string, tierCount: number, batch: number): Batch {
  const rng = createRng(`${seed}:tu:batch:${batch}`);
  const spec = batchSpec(batch);
  const pool = shuffle(rng, Array.from({ length: tierCount }, (_, i) => i)).slice(0, Math.min(spec.tiers, tierCount));
  const pos = layout(rng, spec);
  const order = removalOrder(rng, pos);
  const tiersInOrder = assignTiers(rng, pos.length, spec, pool);
  const tiles: DealtTile[] = pos.map((p) => ({ ...p, tier: -1 }));
  order.forEach((i, n) => (tiles[i].tier = tiersInOrder[n]));
  return { tiles, solution: order };
}
