import { expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import type { GameRun } from "@/generated/prisma/client";
import { defaultTierDefs, MAX_DROPS } from "@/lib/game";
import { tuSeed } from "@/lib/tu";
import { finishSchema, parseGameInput, verifyBigRun } from "@/server/game";
import { tuFinishSchema, verifyTuRun } from "@/server/tu";
import { greedyRun } from "../support/gameBot";
import { randomTu } from "../support/tuBot";

function measure(label: string, fn: () => number) {
  const times: number[] = [];
  fn(); // Warm engine code before the measured replays.
  for (let i = 0; i < 7; i++) {
    const start = performance.now();
    expect(fn()).toBeGreaterThanOrEqual(0);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  process.stdout.write(`S5 replay ${label}: median=${times[3].toFixed(2)}ms max=${times.at(-1)!.toFixed(2)}ms n=7\n`);
}

it("benchmarks full server verification of a long BIG run and a valid 20000-entry TU log", () => {
  const startedAt = new Date("2026-10-30T12:00:00Z"), now = new Date(+startedAt + 6 * 3600_000);
  const tiers = defaultTierDefs(["a", "b", "c", "d"]);
  // Find the longest deterministic run in the existing tuning seed set; no artificial physics.
  const candidates = Array.from({ length: 20 }, (_, i) => ({ seed: `g${i}`, bot: greedyRun(`g${i}`, tiers, MAX_DROPS) }));
  const { seed, bot } = candidates.sort((a, b) => b.bot.steps - a.bot.steps)[0];
  expect(bot.log.length).toBeGreaterThan(100);
  const run = { seed, tiersSnapshot: tiers, startedAt } as unknown as GameRun;
  const runId = "11111111-1111-4111-8111-111111111111";
  const body = { runId, drops: bot.log };
  measure(`BIG drops=${bot.log.length} steps=${bot.steps}`, () => verifyBigRun(run, parseGameInput(finishSchema, body), now).score);
  const tuTiers = [{ id: "a" }, { id: "b" }];
  const tu = randomTu(tuSeed("two"), tuTiers);
  expect(tu.taps).toHaveLength(20_000);
  const tuRun = { seed: tuSeed("two"), tiersSnapshot: tuTiers, startedAt } as unknown as GameRun;
  measure("TU entries=20000", () => verifyTuRun(tuRun, parseGameInput(tuFinishSchema, { runId, taps: tu.taps }), now).score);
}, 30_000);
