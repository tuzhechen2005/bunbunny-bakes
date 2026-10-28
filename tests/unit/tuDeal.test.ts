// 兔了个兔 batch generator: layout rules and solvability (D122: every batch is generated solvable).

import { describe, expect, it } from "vitest";
import { BAG_SIZE, BATCHES, batchSpec, BOARD_H, BOARD_W, createTuGame, dealBatch, overlaps, type TuEvent } from "@/lib/tu";

const tiersOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));

describe("dealBatch layout", () => {
  it("is deterministic in (seed, batch) and differs between seeds and batches", () => {
    expect(dealBatch("s", 8, 3)).toEqual(dealBatch("s", 8, 3));
    expect(dealBatch("s", 8, 3)).not.toEqual(dealBatch("t", 8, 3));
    expect(dealBatch("s", 8, 3).tiles).not.toEqual(dealBatch("s", 8, 4).tiles);
  });

  it("batch 1 is 4 breads, 3 layers, 30 tiles; later batches grow to 8 breads and 6 layers, then repeat", () => {
    expect(batchSpec(1)).toMatchObject({ tiers: 4, layers: 3, tiles: 30 });
    for (let b = 2; b <= BATCHES.length; b++) {
      expect(batchSpec(b).tiers).toBeGreaterThanOrEqual(batchSpec(b - 1).tiers);
      expect(batchSpec(b).layers).toBeGreaterThanOrEqual(batchSpec(b - 1).layers);
      expect(batchSpec(b).tiles).toBeGreaterThan(batchSpec(b - 1).tiles);
    }
    expect(batchSpec(BATCHES.length)).toMatchObject({ tiers: 8, layers: 6 });
    expect(batchSpec(50)).toEqual(batchSpec(BATCHES.length));
    for (const s of BATCHES) expect(s.tiles % 3).toBe(0);
    // spread 5+ can dead-end the witness (5 singletons in the bag): see the guard in deal.ts.
    for (const s of BATCHES) expect(s.spread).toBeLessThanOrEqual(4);
  });

  it.each([2, 4, 5, 8])("lays out every batch inside the board with %i shop tiers", (n) => {
    for (let seed = 0; seed < 60; seed++) {
      for (let b = 1; b <= BATCHES.length + 1; b++) {
        const spec = batchSpec(b);
        const { tiles, solution } = dealBatch(`L${seed}`, n, b);
        expect(tiles).toHaveLength(spec.tiles);
        expect([...solution].sort((x, y) => x - y)).toEqual(tiles.map((_, i) => i));
        // Tiers: the first k of a shuffle, every one in triples.
        const counts = new Map<number, number>();
        for (const t of tiles) counts.set(t.tier, (counts.get(t.tier) ?? 0) + 1);
        expect(counts.size).toBe(Math.min(spec.tiers, n));
        for (const [tier, c] of counts) {
          expect(tier >= 0 && tier < n).toBe(true);
          expect(c % 3).toBe(0);
        }
        const layers = new Set(tiles.map((t) => t.layer));
        expect(layers.size).toBe(spec.layers);
        const bad = tiles.filter(
          (t) =>
            !(t.x2 >= 0 && t.x2 + 2 <= 2 * BOARD_W && t.y2 >= 0 && t.y2 + 2 <= 2 * BOARD_H) ||
            // Same layer never overlaps; upper layers rest on the one below.
            tiles.some((o) => o !== t && o.layer === t.layer && overlaps(o, t)) ||
            (t.layer > 0 && !tiles.some((o) => o.layer === t.layer - 1 && overlaps(o, t))),
        );
        expect(bad).toEqual([]);
      }
    }
  });
});

/** Plays batch after batch with the generator's witness order through the real engine. */
function clearWithWitness(seed: string, n: number, batches: number) {
  const g = createTuGame({ seed, tiers: tiersOf(n) });
  for (let b = 1; b <= batches; b++) {
    const s = g.state();
    expect(s.batch).toBe(b);
    expect(s.bag).toEqual([]);
    const ids = s.tiles.map((t) => t.id);
    const { solution } = dealBatch(seed, n, b);
    for (const i of solution) {
      const ev = g.tap(ids[i]) as TuEvent[] | null;
      if (!ev || ev.some((e) => e.type === "over")) throw new Error(`witness failed: ${seed} batch ${b}`);
    }
    expect(g.batch).toBe(b + 1);
  }
  return g;
}

describe("every batch is solvable", () => {
  it("the witness clears batches 1-7 in the engine for 500 seeds (8 tiers), never filling the bag", () => {
    for (let seed = 0; seed < 500; seed++) clearWithWitness(`S${seed}`, 8, BATCHES.length);
  }, 60_000);

  it.each([2, 3, 4, 5, 6, 7])("also with %i shop tiers (150 seeds)", (n) => {
    for (let seed = 0; seed < 150; seed++) clearWithWitness(`S${n}:${seed}`, n, BATCHES.length);
  }, 60_000);

  it("the witness bag never holds 6 (or 3 of a kind) after a move", () => {
    for (let seed = 0; seed < 200; seed++) {
      for (let b = 1; b <= BATCHES.length; b++) {
        const { tiles, solution } = dealBatch(`W${seed}`, 8, b);
        const bag: number[] = [];
        for (const i of solution) {
          bag.push(tiles[i].tier);
          const same = bag.filter((t) => t === tiles[i].tier).length;
          if (same === 3) for (let k = 0; k < 3; k++) bag.splice(bag.indexOf(tiles[i].tier), 1);
          if (bag.length >= BAG_SIZE) throw new Error(`witness fills the bag: W${seed} batch ${b}`);
        }
        expect(bag).toEqual([]);
      }
    }
  });
});
