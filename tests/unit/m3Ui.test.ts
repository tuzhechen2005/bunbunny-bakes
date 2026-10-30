import { describe, expect, it } from "vitest";
import { createM3Game, legalM3Moves } from "@/lib/m3";
import { animationQueue, swipeDirection, swipeTarget } from "@/components/m3/m3Animation";
import { parseM3Save } from "@/components/m3/m3Save";

const tiers = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, radius: .1, points: 10, imageUrl: null, color: { bg: "var(--c-wash)", ink: "var(--c-ink)" } }));
describe("M3 gestures", () => {
  it("locks the dominant axis from the first move, including vertical board drags", () => {
    expect(swipeDirection(1, 0)).toBe("right");
    expect(swipeDirection(2, -3)).toBe("up");
    expect(swipeDirection(-4, 2)).toBe("left");
    expect(swipeDirection(0, 5)).toBe("down");
    expect(swipeDirection(0, 0)).toBeNull();
    expect(swipeTarget({ r: 0, c: 0 }, "up")).toBeNull();
    expect(swipeTarget({ r: 2, c: 3 }, "right")).toEqual({ r: 2, c: 4 });
  });
});
it("plays engine events in order and reconstructs the entire game without mutating snapshots", () => {
  const game = createM3Game({ seed: "m3-tune87", tiers });
  while (!game.over) {
    const before = game.state();
    const frozen = JSON.stringify(before);
    const m = legalM3Moves(before)[0];
    const events = game.swap(m.a, m.b)!;
    const queue = animationQueue(before, events);
    expect(queue.map(f => f.event)).toEqual(events);
    expect(queue.at(-1)!.after).toEqual(game.state());
    expect(JSON.stringify(before)).toBe(frozen);
  }
});
it("validates saves by replay: expiry, shape, timestamps, illegal moves, score and version", () => {
  const seed = "save";
  const game = createM3Game({ seed, tiers });
  const move = { ...legalM3Moves(game.state())[0], at: 0 };
  game.swap(move.a, move.b);
  const save = { v: 1, runId: "run", seed, tiers, moves: [move], nickname: "baker", expiresAt: "2099-01-01", score: game.score };
  const parse = (patch: object = {}) => parseM3Save(JSON.stringify({ ...save, ...patch }), 0);
  expect(parse()).toEqual(save);
  for (const patch of [{ v: 2 }, { score: 99999 }, { tiers: tiers.slice(1) }, { tiers: [null, ...tiers.slice(1)] }, { moves: [{ ...move, at: -1 }] }, { moves: [{ ...move, b: move.a }] }, { expiresAt: "bad" }, { expiresAt: "1970-01-01" }]) expect(parse(patch)).toBeNull();
  expect(parse({ moves: [], score: 0 })).not.toBeNull();
  expect(parseM3Save("{broken", 0)).toBeNull();
});
