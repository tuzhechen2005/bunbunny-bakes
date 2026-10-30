import type { GameKind } from "./gameCatalog";

// D142: first appearance planned for the week of 2026-10-26; prizes start NEXT Monday.
// Move this date forward if the first production appearance is delayed. Chicago Monday date.
export const M3_PRIZE_FROM_WEEK = "2026-11-02";
const PRIZE_POOL: readonly GameKind[] = ["BIG", "TU", "M3"];

export function eligiblePrizeGames(weekKey: string, breadTierCount: number): GameKind[] {
  return PRIZE_POOL.filter(game => game !== "M3" || (weekKey >= M3_PRIZE_FROM_WEEK && breadTierCount >= 6));
}
