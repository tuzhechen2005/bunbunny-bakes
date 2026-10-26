// Merges must not launch pieces off the visible board: no body ever leaves through the top,
// and nothing moves at absurd speed (the player would see pieces vanish).

import { describe, expect, it } from "vitest";
import { createGame, createRng, defaultTierDefs, type Game } from "@/lib/game";

const TIERS = defaultTierDefs(["a", "b", "c", "d", "e"]);
const SPEED_LIMIT = 0.08; // world units per 1/120 s step (about 9 board widths per second; was ~23 before)

function watch(g: Game, steps: number, seen: { maxSpeed: number; minTop: number }) {
  let prev = new Map<number, [number, number]>();
  for (let i = 0; i < steps && !g.over; i++) {
    g.step();
    const s = g.state();
    const cur = new Map<number, [number, number]>();
    for (const b of s.bodies) {
      seen.minTop = Math.min(seen.minTop, b.y - b.r);
      const p = prev.get(b.id);
      if (p) seen.maxSpeed = Math.max(seen.maxSpeed, Math.abs(b.x - p[0]), Math.abs(b.y - p[1]));
      cur.set(b.id, [b.x, b.y]);
    }
    prev = cur;
  }
}

describe("bodies stay on the visible board", () => {
  it("random and greedy-ish play over many seeds: nothing above the top, speeds bounded", () => {
    const seen = { maxSpeed: 0, minTop: Infinity };
    for (let seed = 0; seed < 24; seed++) {
      const g = createGame({ seed: `bounds${seed}`, tiers: TIERS, width: 1, height: 1.5 });
      const rng = createRng(`bounds-aim${seed}`);
      for (let d = 0; d < 400 && !g.over; d++) {
        // Alternate between aiming over an existing body of the hand's tier (many merges) and random.
        const s = g.state();
        const same = s.bodies.filter((b) => b.tier === g.nextPiece());
        const x = same.length > 0 && d % 2 === 0 ? same[0].x : rng.next();
        g.drop(x);
        watch(g, 30 + rng.int(40), seen);
      }
    }
    // The ceiling is the top of the visible board: every body is fully inside it.
    expect(seen.minTop).toBeGreaterThanOrEqual(-1e-9);
    expect(seen.maxSpeed).toBeLessThanOrEqual(SPEED_LIMIT);
  });
});
