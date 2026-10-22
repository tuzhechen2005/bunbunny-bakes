import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fromDbDate, toDbDate } from "@/server/dbDates";
import { db, resetDb } from "./helpers";

const ORIGINAL_TZ = process.env.TZ;

afterAll(async () => {
  await db.$disconnect();
});

describe.each(["Asia/Shanghai", "America/Chicago", "UTC"])("dbDates in TZ=%s", (tz) => {
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    expect(process.env.TZ).toBe(tz);
  });

  it("toDbDate is UTC midnight of the calendar day", () => {
    expect(toDbDate("2026-10-24").toISOString()).toBe("2026-10-24T00:00:00.000Z");
    expect(toDbDate("2026-03-08").toISOString()).toBe("2026-03-08T00:00:00.000Z"); // DST start
    expect(toDbDate("2026-11-01").toISOString()).toBe("2026-11-01T00:00:00.000Z"); // DST end
    expect(toDbDate("2028-02-29").toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("fromDbDate(toDbDate(d)) === d", () => {
    for (const d of ["2026-01-01", "2026-03-08", "2026-10-24", "2026-11-01", "2026-12-31", "2028-02-29"]) {
      expect(fromDbDate(toDbDate(d))).toBe(d);
    }
  });

  it("rejects invalid input", () => {
    expect(() => toDbDate("2026-02-30")).toThrow();
    expect(() => toDbDate("2026-1-5")).toThrow();
    expect(() => fromDbDate(new Date("2026-10-24T05:00:00Z"))).toThrow(/UTC midnight/);
    expect(() => fromDbDate(new Date("nope"))).toThrow();
  });

  it("round-trips through a real @db.Date column", async () => {
    if (tz === "Asia/Shanghai") {
      // Prove the TZ switch took effect in this process (UTC+8, no DST).
      expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-480);
    }
    const dates = ["2026-01-01", "2026-03-08", "2026-10-24", "2026-11-01", "2026-12-31"];
    for (const d of dates) await db.openDate.create({ data: { date: toDbDate(d) } });
    const rows = await db.openDate.findMany({ orderBy: { date: "asc" } });
    expect(rows.map((r) => fromDbDate(r.date))).toEqual(dates);
    // Postgres agrees on the calendar day.
    const text = await db.$queryRaw<{ d: string }[]>`
      SELECT to_char("date", 'YYYY-MM-DD') AS d FROM "OpenDate" ORDER BY "date"`;
    expect(text.map((r) => r.d)).toEqual(dates);
    // Lookup by toDbDate finds the row.
    const one = await db.openDate.findUnique({ where: { date: toDbDate("2026-10-24") } });
    expect(one && fromDbDate(one.date)).toBe("2026-10-24");
  });
});
