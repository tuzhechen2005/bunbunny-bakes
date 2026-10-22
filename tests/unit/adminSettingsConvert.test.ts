import { describe, expect, it } from "vitest";
import {
  centsToDollars,
  dollarsToCents,
  isAllowedCutoffTime,
  parseIntStrict,
} from "@/components/admin/settings/convert";

describe("dollarsToCents", () => {
  it.each([
    ["5", 500],
    ["5.5", 550],
    ["5.50", 550],
    ["0.07", 7],
    ["0", 0],
    ["$25", 2500],
    [" 12.34 ", 1234],
    ["19.99", 1999], // would be 1998.9999… with float math
    ["1.15", 115],
    ["0.29", 29],
  ])("%j -> %i", (input, cents) => {
    expect(dollarsToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "5.555", "-1", "1e3", "5.", ".5", "1,5", "99999999"])("rejects %j", (input) => {
    expect(dollarsToCents(input)).toBeNull();
  });
});

describe("centsToDollars", () => {
  it.each([
    [500, "5"],
    [550, "5.50"],
    [505, "5.05"],
    [0, "0"],
    [2599, "25.99"],
  ])("%i -> %j", (cents, text) => {
    expect(centsToDollars(cents)).toBe(text);
    expect(dollarsToCents(text)).toBe(cents);
  });
});

describe("parseIntStrict", () => {
  it("accepts digits only", () => {
    expect(parseIntStrict(" 1600 ")).toBe(1600);
    expect(parseIntStrict("0")).toBe(0);
    for (const bad of ["", "1.5", "-1", "1e3", "abc", "1234567890"]) expect(parseIntStrict(bad)).toBeNull();
  });
});

describe("isAllowedCutoffTime", () => {
  it("rejects 01:00-02:59 and malformed values", () => {
    for (const ok of ["00:00", "00:59", "03:00", "20:00", "23:59"]) expect(isAllowedCutoffTime(ok)).toBe(true);
    for (const bad of ["01:00", "02:59", "02:00", "24:00", "8:00", ""]) expect(isAllowedCutoffTime(bad)).toBe(false);
  });
});
