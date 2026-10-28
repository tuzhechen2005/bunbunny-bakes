import { describe, expect, it } from "vitest";
import { isVisible, revealedIds } from "@/components/tu/tuVisible";
import type { TuEvent, TuTile } from "@/lib/tu";

const tile = (extra: object = {}): TuTile => ({ id: 1, tier: 0, x: 0, y: 0, layer: 0, free: false, visible: true, ...extra });

describe("tu hidden tiles (C7)", () => {
  it("a missing visible counts as true; only false hides", () => {
    expect(isVisible(tile())).toBe(true);
    expect(isVisible(tile({ visible: true }))).toBe(true);
    expect(isVisible(tile({ visible: false }))).toBe(false);
  });
  it("collects reveal ids and ignores other or malformed events", () => {
    const evs = [
      { type: "move", tile: 1, tier: 0, slot: 0 },
      { type: "reveal", tiles: [4, 5] },
      { type: "reveal", tiles: "x" },
      { type: "reveal" },
      { type: "reveal", tiles: [7, "a"] },
      { type: "mystery" },
    ] as unknown as TuEvent[];
    expect(revealedIds(evs)).toEqual([4, 5, 7]);
    expect(revealedIds([])).toEqual([]);
  });
});
