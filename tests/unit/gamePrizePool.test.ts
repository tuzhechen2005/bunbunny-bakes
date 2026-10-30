import { expect, it } from "vitest";
import { eligiblePrizeGames, M3_PRIZE_FROM_WEEK } from "@/lib/gamePrizePool";
it("admits M3 only from its configured following week and with six bread tiers", () => {
  expect(eligiblePrizeGames("2026-11-23", 8)).toEqual(["BIG", "TU"]);
  expect(eligiblePrizeGames(M3_PRIZE_FROM_WEEK, 5)).toEqual(["BIG", "TU"]);
  expect(eligiblePrizeGames(M3_PRIZE_FROM_WEEK, 6)).toEqual(["BIG", "TU", "M3"]);
  expect(eligiblePrizeGames("2026-12-07", 8)).toContain("M3");
  expect(eligiblePrizeGames("2026-12-07", 0)).not.toContain("M3");
});
