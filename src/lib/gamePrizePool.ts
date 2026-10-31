import type { GameKind } from "./gameCatalog";

// D142: M3 joins the prize pool the week after its first production week (deploy planned after 11/22).
// Move this date forward if the first production appearance is delayed. Chicago Monday date.
export const M3_PRIZE_FROM_WEEK = "2026-11-30";
// PRE-DEPLOY: set to the Chicago Monday after the actual first production week.
export const GRAB_PRIZE_FROM_WEEK = "2026-12-07";
const PRIZE_POOL: readonly GameKind[] = ["BIG", "TU", "M3", "GRAB"];

export function eligiblePrizeGames(weekKey: string, breadTierCount: number): GameKind[] {
  return PRIZE_POOL.filter(game => (game !== "M3" || (weekKey >= M3_PRIZE_FROM_WEEK && breadTierCount >= 6))
    && (game !== "GRAB" || (weekKey >= GRAB_PRIZE_FROM_WEEK && breadTierCount >= 3)));
}
