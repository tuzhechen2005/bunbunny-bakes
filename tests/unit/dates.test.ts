import { describe, expect, it } from "vitest";
import {
  SHOP_TZ,
  addDays,
  compareLocalDate,
  dayLabel,
  isLocalDate,
  localDateOf,
  weekdayOf,
} from "@/domain/dates";

describe("SHOP_TZ", () => {
  it("is America/Chicago", () => {
    expect(SHOP_TZ).toBe("America/Chicago");
  });
});

describe("isLocalDate", () => {
  it("accepts real calendar days", () => {
    expect(isLocalDate("2026-10-30")).toBe(true);
    expect(isLocalDate("2028-02-29")).toBe(true);
    expect(isLocalDate("2026-12-31")).toBe(true);
  });

  it("rejects 2026-02-30 (not a real day)", () => {
    expect(isLocalDate("2026-02-30")).toBe(false);
  });

  it("rejects 2026-1-05 (not zero-padded)", () => {
    expect(isLocalDate("2026-1-05")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isLocalDate("")).toBe(false);
  });

  it("rejects other malformed inputs", () => {
    for (const s of [
      "2027-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-04-31",
      "2026-10-00",
      "2026-10-30T00:00",
      " 2026-10-30",
      "2026-10-30\n",
      "2026/10/30",
      "26-10-30",
    ]) {
      expect(isLocalDate(s), JSON.stringify(s)).toBe(false);
    }
  });
});

describe("addDays", () => {
  it("adds within a month", () => {
    expect(addDays("2026-10-28", 2)).toBe("2026-10-30");
  });

  it("crosses a month end", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("crosses a year end", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("crosses the DST end (2026-11-01) and DST start (2027-03-14)", () => {
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
    expect(addDays("2026-11-02", -2)).toBe("2026-10-31");
    expect(addDays("2027-03-13", 2)).toBe("2027-03-15");
    expect(addDays("2027-03-15", -1)).toBe("2027-03-14");
  });

  it("n = 0 returns the same day", () => {
    expect(addDays("2026-10-30", 0)).toBe("2026-10-30");
  });

  it("throws on an invalid LocalDate", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow();
    expect(() => addDays("", 1)).toThrow();
  });

  it("throws on a non-integer n", () => {
    expect(() => addDays("2026-10-30", 1.5)).toThrow();
  });
});

describe("compareLocalDate", () => {
  it("orders dates", () => {
    expect(compareLocalDate("2026-10-29", "2026-10-30")).toBeLessThan(0);
    expect(compareLocalDate("2026-10-30", "2026-10-30")).toBe(0);
    expect(compareLocalDate("2027-01-01", "2026-12-31")).toBeGreaterThan(0);
  });

  it("throws on an invalid LocalDate", () => {
    expect(() => compareLocalDate("2026-1-05", "2026-01-05")).toThrow();
  });
});

describe("localDateOf", () => {
  it("2026-10-30T04:59:59Z is still 10/29 in Chicago (CDT)", () => {
    expect(localDateOf(new Date("2026-10-30T04:59:59Z"))).toBe("2026-10-29");
  });

  it("2026-10-30T05:00:00Z is 10/30 in Chicago (CDT)", () => {
    expect(localDateOf(new Date("2026-10-30T05:00:00Z"))).toBe("2026-10-30");
  });

  it("around the DST end: after 11/1, midnight is at 06:00Z (CST)", () => {
    expect(localDateOf(new Date("2026-11-01T04:59:59Z"))).toBe("2026-10-31");
    expect(localDateOf(new Date("2026-11-01T05:00:00Z"))).toBe("2026-11-01");
    // 01:30 CDT and 01:30 CST on 11/1 are both 11/1.
    expect(localDateOf(new Date("2026-11-01T06:30:00Z"))).toBe("2026-11-01");
    expect(localDateOf(new Date("2026-11-01T07:30:00Z"))).toBe("2026-11-01");
    expect(localDateOf(new Date("2026-11-02T05:59:59Z"))).toBe("2026-11-01");
    expect(localDateOf(new Date("2026-11-02T06:00:00Z"))).toBe("2026-11-02");
  });

  it("around the DST start (2027-03-14)", () => {
    expect(localDateOf(new Date("2027-03-14T05:59:59Z"))).toBe("2027-03-13");
    expect(localDateOf(new Date("2027-03-14T06:00:00Z"))).toBe("2027-03-14");
    expect(localDateOf(new Date("2027-03-15T04:59:59Z"))).toBe("2027-03-14");
    expect(localDateOf(new Date("2027-03-15T05:00:00Z"))).toBe("2027-03-15");
  });

  it("throws on an invalid Date", () => {
    expect(() => localDateOf(new Date("nope"))).toThrow();
  });
});

describe("weekdayOf", () => {
  it("0 = Sunday", () => {
    expect(weekdayOf("2026-11-01")).toBe(0);
    expect(weekdayOf("2026-10-30")).toBe(5);
    expect(weekdayOf("2026-10-31")).toBe(6);
    expect(weekdayOf("2026-11-02")).toBe(1);
  });

  it("throws on an invalid LocalDate", () => {
    expect(() => weekdayOf("2026-02-30")).toThrow();
  });
});

describe("dayLabel", () => {
  it("formats 2026-10-30 as '10/30 周五'", () => {
    expect(dayLabel("2026-10-30")).toBe("10/30 周五");
  });

  it("does not zero-pad month/day: 2026-11-01 → '11/1 周日'", () => {
    expect(dayLabel("2026-11-01")).toBe("11/1 周日");
    expect(dayLabel("2027-01-05")).toBe("1/5 周二");
  });

  it("throws on an invalid LocalDate", () => {
    expect(() => dayLabel("")).toThrow();
  });
});
