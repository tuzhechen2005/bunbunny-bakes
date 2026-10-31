import { expect, it } from "vitest";
import { runSeed, runSeedVersion, RUN_ENGINE_VERSION } from "@/lib/run";
import { isRunSuspicious } from "@/server/runRules";
it("pins replay versions", () => {
  expect(runSeedVersion(runSeed("ab12"))).toBe(RUN_ENGINE_VERSION);
  expect(runSeedVersion("legacy")).toBeNull();
});
it("flags median gaps below 120ms or active durations strictly over ten minutes", () => {
  const log = (ticks: number[]) => ticks.map(tick => ({tick, dir: "L" as const}));
  expect(isRunSuspicious(log([0,7,14]), 14)).toBe(true);
  expect(isRunSuspicious(log([0,8,16]), 16)).toBe(false);
  expect(isRunSuspicious(log([0,7,15]), 16)).toBe(false);
  expect(isRunSuspicious([], 36000)).toBe(false);
  expect(isRunSuspicious([], 36001)).toBe(true);
});
