/** All inputs are server-replayed performance; RUN uses distance in metres. */
export function gameCoins(game: "BIG" | "TU" | "GRAB" | "RUN" | "M3" | "TD", score: number, level = 1, passed = false): number {
  const value = game === "RUN" ? Math.floor(score / 100)
    : game === "M3" || game === "TD" ? (passed ? level * 5 : 5)
    : Math.floor(score / ({ BIG: 500, TU: 100, GRAB: 100 }[game])) * 5;
  return Math.max(5, Math.min(30, value));
}
export const orderCoins = (subtotalCents: number): number => Math.floor(subtotalCents / 100) * 10;
export const SHOP_CATALOG = [
  { item: "bomb", price: 60, game: "TD" },
  { item: "bell", price: 100, game: "TD" },
  { item: "slide", price: 80, game: "TD" },
] as const;
export type ShopItem = typeof SHOP_CATALOG[number]["item"];
