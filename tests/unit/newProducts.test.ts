import { describe, expect, it } from "vitest";
import { newProductUntil, presentNewProducts } from "@/domain/newProducts";

const now = new Date("2026-11-01T05:30:00.000Z");
describe("new products", () => {
  it("uses exactly 168 hours across daylight saving changes", () => {
    expect(newProductUntil(now).toISOString()).toBe("2026-11-08T05:30:00.000Z");
  });
  it("expires at equality, hides the timestamp, and stably partitions without mutating input", () => {
    const rows = [
      { id: "old", newUntil: null },
      { id: "new1", newUntil: new Date(now.getTime() + 1) },
      { id: "boundary", newUntil: now },
      { id: "new2", newUntil: newProductUntil(now) },
      { id: "expired", newUntil: new Date(now.getTime() - 1) },
    ];
    expect(presentNewProducts(rows, now)).toEqual([
      { id: "new1", isNew: true }, { id: "new2", isNew: true },
      { id: "old", isNew: false }, { id: "boundary", isNew: false }, { id: "expired", isNew: false },
    ]);
    expect(rows.map(p => p.id)).toEqual(["old", "new1", "boundary", "new2", "expired"]);
    expect(rows[1]).not.toHaveProperty("isNew");
    expect(presentNewProducts([], now)).toEqual([]);
  });
});
