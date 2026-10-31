import { expect, it } from "vitest";
import { eligiblePrizeGames, M3_PRIZE_FROM_WEEK, GRAB_PRIZE_FROM_WEEK, RUN_PRIZE_FROM_WEEK } from "@/lib/gamePrizePool";
it("admits M3 only from its configured following week and with six bread tiers", () => {
  expect(eligiblePrizeGames("2026-11-23", 8)).toEqual(["BIG", "TU"]);
  expect(eligiblePrizeGames(M3_PRIZE_FROM_WEEK, 5)).toEqual(["BIG", "TU"]);
  expect(eligiblePrizeGames(M3_PRIZE_FROM_WEEK, 6)).toEqual(["BIG", "TU", "M3"]);
  expect(eligiblePrizeGames("2026-12-07", 8)).toContain("M3");
  expect(eligiblePrizeGames("2026-12-07", 0)).not.toContain("M3");
});

it("GRAB joins only after its first production week and with at least three breads", () => {
  expect(eligiblePrizeGames("2026-12-06", 8)).not.toContain("GRAB");
  expect(eligiblePrizeGames(GRAB_PRIZE_FROM_WEEK, 2)).not.toContain("GRAB");
  expect(eligiblePrizeGames(GRAB_PRIZE_FROM_WEEK, 3)).toEqual(["BIG", "TU", "GRAB", "RUN"]);
  expect(eligiblePrizeGames(GRAB_PRIZE_FROM_WEEK, 8)).toEqual(["BIG", "TU", "M3", "GRAB", "RUN"]);
});

it("RUN is independent of bread tiers and joins only from its following week", () => {
  expect(eligiblePrizeGames("2026-12-06", 0)).not.toContain("RUN");
  expect(eligiblePrizeGames(RUN_PRIZE_FROM_WEEK, 0)).toEqual(["BIG", "TU", "RUN"]);
});
