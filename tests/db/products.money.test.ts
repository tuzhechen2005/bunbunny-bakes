// Dollars -> cents parsing for the product form: exact string arithmetic, no floats.

import { describe, expect, it } from "vitest";
import { centsToDollarInput, parseDollarsToCents } from "@/components/admin/products/money";

describe("parseDollarsToCents", () => {
  it.each([
    ["2.49", 249],
    ["10", 1000],
    ["0.1", 10],
    ["0", 0],
    ["0.00", 0],
    ["$3", 300],
    ["  8.99 ", 899],
    ["19.9", 1990],
    ["0.07", 7],
    ["10000", 1_000_000],
  ])("%s -> %i", (input, cents) => {
    expect(parseDollarsToCents(input)).toEqual({ ok: true, cents });
  });

  it.each(["1.005", "2.499", "", " ", "-1", "+1", "1e3", "1,000", ".5", "5.", "abc", "1.2.3", "10000.01", "99999999"])(
    "rejects %j",
    (input) => {
      expect(parseDollarsToCents(input)).toEqual({ ok: false });
    },
  );

  it("never goes through floats (1.15 * 100 would be 114.99999999999999)", () => {
    expect(parseDollarsToCents("1.15")).toEqual({ ok: true, cents: 115 });
    expect(parseDollarsToCents("4.35")).toEqual({ ok: true, cents: 435 });
  });
});

describe("centsToDollarInput", () => {
  it("round-trips with parseDollarsToCents", () => {
    for (const cents of [0, 1, 10, 99, 100, 249, 899, 1000, 123456]) {
      expect(parseDollarsToCents(centsToDollarInput(cents))).toEqual({ ok: true, cents });
    }
    expect(centsToDollarInput(249)).toBe("2.49");
    expect(centsToDollarInput(1000)).toBe("10.00");
  });
});
