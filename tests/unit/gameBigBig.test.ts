import { describe, expect, it } from "vitest";
import { BoardRenderer } from "@/components/game/render";
import type { GameEvent, TierView } from "@/components/game/types";

const TIERS: TierView[] = [0.08, 0.11, 0.15, 0.2, 0.3].map((radius, i) => ({
  id: i === 4 ? "big" : `t${i}`,
  radius,
  points: i * 10,
  imageUrl: null,
  color: { bg: "#ffffff", ink: "#000000" },
}));
const THEME = { wash: "#eee", paper: "#fff", ink: "#000", line: "#ccc", red: "#f00", numFont: "serif" };

/** Canvas context stand-in: only what the effects code touches. */
function fakeCtx() {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k: string) => (k === "canvas" ? {} : () => void calls.push(k)),
    set: () => true,
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const bigBig: GameEvent = { type: "merge", tier: 4, x: 0.5, y: 0.8, points: 500, big: true, bigBig: true };

describe("big + big celebration (D109)", () => {
  it("starts the effects, bursts after the scale-up, and ends (the loop can stop)", () => {
    const r = new BoardRenderer(fakeCtx().ctx, TIERS, THEME, 0.26, 1.5);
    r.resize(300, 1);
    r.dirty = false;
    r.onEvent(bigBig);
    expect(r.animating).toBe(true);
    // Step the renderer through time without sprites: draw() with an empty board.
    let particlesSeen = 0;
    for (let i = 0; i < 400 && r.animating; i++) {
      r.draw([], null, 0.016, i * 16);
      particlesSeen = Math.max(particlesSeen, (r as unknown as { particles: unknown[] }).particles.length);
    }
    expect(particlesSeen).toBeGreaterThan(30);
    expect(particlesSeen).toBeLessThanOrEqual(200);
    expect(r.animating).toBe(false);
  });

  it("reduced motion: only the fading +500, no confetti, no flash, no shake", () => {
    const r = new BoardRenderer(fakeCtx().ctx, TIERS, THEME, 0.26, 1.5);
    r.reduced = true;
    r.resize(300, 1);
    r.dirty = false;
    r.onEvent(bigBig);
    const priv = r as unknown as { particles: unknown[]; flash: number; shake: number; burst: unknown };
    expect(r.animating).toBe(true);
    for (let i = 0; i < 200 && r.animating; i++) {
      r.draw([], null, 0.016, i * 16);
      expect(priv.particles).toHaveLength(0);
    }
    expect(priv.flash).toBe(0);
    expect(priv.shake).toBe(0);
    expect(priv.burst).toBeNull();
    expect(r.animating).toBe(false);
  });
});
