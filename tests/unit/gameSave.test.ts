import { describe, expect, it } from "vitest";
import { Session } from "@/components/game/engine";
import { parseSave } from "@/components/game/save";
import type { TierView } from "@/components/game/types";

const TIERS: TierView[] = [0.08, 0.11, 0.15, 0.2, 0.3].map((radius, i) => ({
  id: i === 4 ? "big" : `t${i}`,
  radius,
  points: i * 10,
  imageUrl: null,
  color: { bg: "#ffffff", ink: "#000000" },
}));

function play(seed: string, n: number) {
  const s = new Session(TIERS, seed);
  for (let i = 0; i < n && !s.over; i++) {
    s.advance(40);
    s.drop(0.1 + (i % 7) * 0.13);
  }
  return s;
}

describe("autosave (D111)", () => {
  it("restores the same score, drops and board by replaying the drop log", () => {
    const a = play("seed-save", 25);
    const b = Session.restore(TIERS, "seed-save", JSON.parse(JSON.stringify(a.drops)))!;
    expect(b).not.toBeNull();
    expect(b.drops).toEqual(a.drops);
    expect(b.steps).toBe(a.drops.at(-1)!.at);
    // Continue the original to the same step: identical state.
    const c = new Session(TIERS, "seed-save");
    for (const d of a.drops) {
      while (c.steps < d.at) c.advance(1);
      c.drop(d.x);
    }
    expect(b.score).toBe(c.score);
    expect(b.bodies).toEqual(c.bodies);
    // New drops append after the replayed ones.
    b.advance(40);
    b.drop(0.5);
    expect(b.drops).toHaveLength(a.drops.length + 1);
  });

  it("returns null for a log that cannot be replayed", () => {
    expect(Session.restore(TIERS, "s", [{ x: 0.5, at: 10 }, { x: 0.5, at: 12 }])).toBeNull();
    expect(Session.restore(TIERS, "s", [{ x: Number.NaN, at: 0 }])).toBeNull();
  });

  const good = {
    v: 1,
    runId: "r1",
    seed: "s",
    tiers: TIERS,
    drops: [{ x: 0.5, at: 0 }],
    nickname: "n",
    expiresAt: "2026-11-02T06:00:00Z",
    score: 120,
  };
  const now = Date.parse("2026-10-28T12:00:00Z");

  it("parses a valid save and rejects expired, empty and foreign ones", () => {
    expect(parseSave(JSON.stringify(good), now)?.score).toBe(120);
    expect(parseSave(JSON.stringify(good), Date.parse("2026-11-02T06:00:00Z"))).toBeNull();
    expect(parseSave(JSON.stringify({ ...good, drops: [] }), now)).toBeNull();
    expect(parseSave(JSON.stringify({ ...good, v: 2 }), now)).toBeNull();
    expect(parseSave("not json", now)).toBeNull();
    expect(parseSave(null, now)).toBeNull();
  });
});
