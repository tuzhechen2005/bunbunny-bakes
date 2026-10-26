import { describe, expect, it } from "vitest";
import { maskWechat, previousWeekKey, weekKeyOf, weekRange } from "@/server/gameWeek";

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
