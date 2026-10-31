import { expect, it, vi } from "vitest";

// Exercise the real overflow path cheaply, with the same engine used by live and replay.
vi.mock("@/lib/m3/types", async (original) => ({
  ...await original<typeof import("@/lib/m3/types")>(), MAX_CASCADE_STEPS: 2,
}));

import { createM3Game, MAX_CASCADE_STEPS, replayM3 } from "@/lib/m3";
import { findMatches } from "@/lib/m3/board";
import { greedyM3 } from "../support/m3Bot";

it("caps cascading, emits a settled board replacement, and replays identically", () => {
  const tiers = Array.from({ length: 4 }, (_, i) => ({ id: `t${i}` }));
  const seed = "cascade-cap";
  const run = greedyM3(seed, tiers);
  const live = createM3Game({ seed, tiers });
  const twin = createM3Game({ seed, tiers });
  let capped = 0;
  for (const move of run.moves) {
    const events = live.swap(move.a, move.b)!;
    expect(events).toEqual(twin.swap(move.a, move.b));
    const matches = events.filter((e) => e.type === "match");
    expect(matches.length).toBeLessThanOrEqual(MAX_CASCADE_STEPS);
    if (matches.length === MAX_CASCADE_STEPS && events.some((e) => e.type === "shuffle")) capped++;
    expect(findMatches(live.state().board)).toEqual([]);
  }
  expect(capped).toBeGreaterThan(0);
  expect(live.state()).toEqual(twin.state());
  expect(replayM3(seed, tiers, run.moves)).toEqual({ score: live.score, moves: 30, over: true });
});
