import { describe, expect, it } from "vitest";
import { cutoffAt, cutoffLabel, isBeforeCutoff, leadDaysOf } from "@/domain/cutoff";
import type { CartLine } from "@/domain/types";

const products = {
  bread: { leadDays: 1 },
  brulee: { leadDays: 2 },
};
const bread: CartLine[] = [{ productId: "bread", qty: 2 }];
const breadAndBrulee: CartLine[] = [
  { productId: "bread", qty: 1 },
  { productId: "brulee", qty: 1 },
];
const bruleeOnly: CartLine[] = [{ productId: "brulee", qty: 3 }];

/** CAPACITY_RULES.md §6: cutoff for a cart and pickup date at the default 20:00. */
function cutoffFor(lines: CartLine[], pickup: string): string {
  return cutoffAt(pickup, leadDaysOf(lines, products), "20:00").toISOString();
}

describe("leadDaysOf", () => {
  it("bread only → 1", () => {
    expect(leadDaysOf(bread, products)).toBe(1);
  });

  it("bread + brûlée → 2", () => {
    expect(leadDaysOf(breadAndBrulee, products)).toBe(2);
  });

  it("throws on an empty cart", () => {
    expect(() => leadDaysOf([], products)).toThrow();
  });

  it("throws on an unknown product id", () => {
    expect(() => leadDaysOf([{ productId: "ghost", qty: 1 }], products)).toThrow();
  });

  it("does not treat inherited object keys as products", () => {
    expect(() => leadDaysOf([{ productId: "toString", qty: 1 }], products)).toThrow();
  });
});

describe("cutoffAt — CAPACITY_RULES.md §6 examples", () => {
  it("C1: pickup 10/30 Fri, bread only → 10/29 Thu 20:00 CDT = 2026-10-30T01:00:00.000Z", () => {
    expect(cutoffFor(bread, "2026-10-30")).toBe("2026-10-30T01:00:00.000Z");
  });

  it("C2: pickup 10/30 Fri, bread + brûlée → 10/28 Wed 20:00 CDT = 2026-10-29T01:00:00.000Z", () => {
    expect(cutoffFor(breadAndBrulee, "2026-10-30")).toBe("2026-10-29T01:00:00.000Z");
  });

  it("C3: pickup 11/01 Sun, bread only → 10/31 Sat 20:00 CDT = 2026-11-01T01:00:00.000Z", () => {
    expect(cutoffFor(bread, "2026-11-01")).toBe("2026-11-01T01:00:00.000Z");
  });

  it("C4: pickup 11/02 Mon, bread only → 11/01 Sun 20:00 CST = 2026-11-02T02:00:00.000Z", () => {
    expect(cutoffFor(bread, "2026-11-02")).toBe("2026-11-02T02:00:00.000Z");
  });

  it("C5: pickup 11/03 Tue, brûlée only → 11/01 Sun 20:00 CST = 2026-11-02T02:00:00.000Z", () => {
    expect(cutoffFor(bruleeOnly, "2026-11-03")).toBe("2026-11-02T02:00:00.000Z");
  });

  it("C3 vs C4: same 'day before 20:00', but 25 hours apart across the DST end", () => {
    const c3 = cutoffAt("2026-11-01", 1, "20:00").getTime();
    const c4 = cutoffAt("2026-11-02", 1, "20:00").getTime();
    expect(c4 - c3).toBe(25 * 60 * 60 * 1000);
    // UTC hour differs by exactly one: 01:00Z (CDT) vs 02:00Z (CST).
    expect(new Date(c3).getUTCHours()).toBe(1);
    expect(new Date(c4).getUTCHours()).toBe(2);
  });
});

describe("cutoffAt — other cases", () => {
  it("spring-forward sanity: pickup 2027-03-15, leadDays 1 → 2027-03-15T01:00:00.000Z (CDT)", () => {
    expect(cutoffAt("2027-03-15", 1, "20:00").toISOString()).toBe("2027-03-15T01:00:00.000Z");
  });

  it("honors a non-default cutoff time", () => {
    expect(cutoffAt("2026-10-30", 1, "09:05").toISOString()).toBe("2026-10-29T14:05:00.000Z");
    expect(cutoffAt("2026-10-30", 1, "00:00").toISOString()).toBe("2026-10-29T05:00:00.000Z");
    expect(cutoffAt("2026-10-30", 1, "23:59").toISOString()).toBe("2026-10-30T04:59:00.000Z");
  });

  it("leadDays 0 means the pickup day itself", () => {
    expect(cutoffAt("2026-10-30", 0, "20:00").toISOString()).toBe("2026-10-31T01:00:00.000Z");
  });

  it("throws on an invalid pickup date", () => {
    expect(() => cutoffAt("2026-02-30", 1, "20:00")).toThrow();
    expect(() => cutoffAt("2026-1-05", 1, "20:00")).toThrow();
    expect(() => cutoffAt("", 1, "20:00")).toThrow();
  });

  it("throws on an invalid cutoff time", () => {
    for (const t of ["24:00", "20:60", "8:00", "20:0", "2000", "", "20:00:00", "-1:00", " 20:00", "20:00\n"]) {
      expect(() => cutoffAt("2026-10-30", 1, t), JSON.stringify(t)).toThrow();
    }
  });

  it("throws on a negative or non-integer leadDays", () => {
    expect(() => cutoffAt("2026-10-30", -1, "20:00")).toThrow();
    expect(() => cutoffAt("2026-10-30", 1.5, "20:00")).toThrow();
  });
});

describe("isBeforeCutoff", () => {
  const cutoff = new Date("2026-10-30T01:00:00.000Z");

  it("now = cutoff − 1 s → true", () => {
    expect(isBeforeCutoff(new Date(cutoff.getTime() - 1000), cutoff)).toBe(true);
  });

  it("now = cutoff exactly → false", () => {
    expect(isBeforeCutoff(new Date(cutoff.getTime()), cutoff)).toBe(false);
  });

  it("now after cutoff → false", () => {
    expect(isBeforeCutoff(new Date(cutoff.getTime() + 1), cutoff)).toBe(false);
  });
});

describe("cutoffLabel", () => {
  it("C1 → '10/29 周四 20:00 截止'", () => {
    expect(cutoffLabel(cutoffAt("2026-10-30", 1, "20:00"))).toBe("10/29 周四 20:00 截止");
  });

  it("C4 → '11/1 周日 20:00 截止'", () => {
    expect(cutoffLabel(cutoffAt("2026-11-02", 1, "20:00"))).toBe("11/1 周日 20:00 截止");
  });

  it("zero-pads HH:MM", () => {
    expect(cutoffLabel(cutoffAt("2026-10-30", 1, "09:05"))).toBe("10/29 周四 09:05 截止");
  });

  it("throws on an invalid Date", () => {
    expect(() => cutoffLabel(new Date("nope"))).toThrow();
  });
});
