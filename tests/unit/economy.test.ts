import { describe, expect, it } from "vitest";
import { gameCoins, orderCoins } from "@/domain/economy";
import { countItemUses } from "@/lib/td";

describe("coin formulas", () => {
  it("bounds all six games and uses verified performance", () => {
    for (const game of ["BIG", "TU", "GRAB", "RUN", "M3", "TD"] as const) {
      expect(gameCoins(game, 0, 1, false)).toBe(5);
      expect(gameCoins(game, 999999, 99, true)).toBe(30);
    }
    expect(gameCoins("RUN", 1200)).toBe(12);
    expect(gameCoins("M3", 0, 3, true)).toBe(15);
    expect(gameCoins("TD", 0, 4, true)).toBe(20);
    expect(gameCoins("TD", 999, 4, false)).toBe(5);
    expect(gameCoins("BIG", 1499)).toBe(10);
    expect(gameCoins("TU", 299)).toBe(10);
    expect(gameCoins("GRAB", 399)).toBe(15);
    expect(orderCoins(99)).toBe(0);
    expect(orderCoins(2499)).toBe(240);
  });
  it("counts each item input, including repeated uses", () => {
    expect(countItemUses([{ tick: 1, type: "item", item: "bomb", x: 100, y: 100 }, { tick: 2, type: "item", item: "bomb", x: 120, y: 100 }, { tick: 3, type: "place", slot: 0, tower: "rollingPin" }])).toEqual({ bomb: 2, bell: 0, slide: 0 });
  });
});
