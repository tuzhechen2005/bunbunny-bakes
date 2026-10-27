import { describe, expect, it } from "vitest";
import { maskWechat, previousWeekKey, runExpiresAt, weekKeyOf, weekRange, weekStartInstant } from "@/server/gameWeek";

describe("weekKeyOf (Monday 00:00 America/Chicago)", () => {
  it("Monday 00:00 CDT starts the new week, one second earlier is still the old week", () => {
    // 2026-10-26 is a Monday; CDT = UTC-5.
    expect(weekKeyOf(new Date("2026-10-26T05:00:00Z"))).toBe("2026-10-26");
    expect(weekKeyOf(new Date("2026-10-26T04:59:59Z"))).toBe("2026-10-19");
  });

  it("works across the fall DST change (CST = UTC-6 from 2026-11-01)", () => {
    // Monday 2026-11-02 00:00 CST = 06:00Z.
    expect(weekKeyOf(new Date("2026-11-02T06:00:00Z"))).toBe("2026-11-02");
    expect(weekKeyOf(new Date("2026-11-02T05:59:59Z"))).toBe("2026-10-26");
  });

  it("Sunday night Chicago is still the previous Monday's week", () => {
    expect(weekKeyOf(new Date("2026-11-02T04:00:00Z"))).toBe("2026-10-26"); // Sun 22:00 CST
  });

  it("range and previous week", () => {
    expect(weekRange("2026-10-26")).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    expect(previousWeekKey("2026-10-26")).toBe("2026-10-19");
  });
});

describe("runExpiresAt (the weekly reset after the start, D111)", () => {
  it("is the next Monday 00:00 Chicago, whatever time of the week the run started", () => {
    const reset = "2026-10-26T05:00:00.000Z"; // Mon 10-26 00:00 CDT
    expect(runExpiresAt(new Date("2026-10-19T05:00:00Z")).toISOString()).toBe(reset); // Mon 00:00
    expect(runExpiresAt(new Date("2026-10-21T17:00:00Z")).toISOString()).toBe(reset); // Wed noon
    expect(runExpiresAt(new Date("2026-10-26T04:59:59Z")).toISOString()).toBe(reset); // Sun 23:59:59
    expect(runExpiresAt(new Date("2026-10-26T05:00:00Z")).toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });

  it("handles the fall-back week (CDT -> CST on Sun 2026-11-01): 169 hours long", () => {
    const start = weekStartInstant("2026-10-26");
    const end = runExpiresAt(new Date("2026-10-31T12:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-26T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T06:00:00.000Z");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(169);
  });

  it("handles the spring-forward week (CST -> CDT on Sun 2027-03-14): 167 hours long", () => {
    const start = weekStartInstant("2027-03-08");
    const end = runExpiresAt(new Date("2027-03-14T12:00:00Z"));
    expect(start.toISOString()).toBe("2027-03-08T06:00:00.000Z");
    expect(end.toISOString()).toBe("2027-03-15T05:00:00.000Z");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(167);
  });
});

describe("maskWechat", () => {
  it("first 2 + *** + last 2", () => {
    expect(maskWechat("bunbunny_fan")).toBe("bu***an");
    expect(maskWechat("abcde")).toBe("ab***de");
  });
  it("short ids keep only the first character", () => {
    expect(maskWechat("abcd")).toBe("a***");
    expect(maskWechat("ab")).toBe("a***");
    expect(maskWechat("a")).toBe("a***");
  });
  it("is code point safe", () => {
    expect(maskWechat("🐰🐰bread🐰🐰")).toBe("🐰🐰***🐰🐰");
  });
});
