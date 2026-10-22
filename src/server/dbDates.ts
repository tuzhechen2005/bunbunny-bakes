// Conversions between LocalDate ("YYYY-MM-DD", a Chicago calendar day) and the
// JS Date that Prisma uses for `@db.Date` columns. Prisma reads and writes
// `date` as UTC midnight, so only UTC getters/constructors are used here;
// the machine's local timezone must never matter.

import { parseLocalDate } from "@/domain/dates";
import type { LocalDate } from "@/domain/types";

/** LocalDate -> Date at UTC midnight of that calendar day. Throws on an invalid date. */
export function toDbDate(d: LocalDate): Date {
  const { year, month, day } = parseLocalDate(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC maps years 0-99 to 1900-1999; set the full year explicitly.
  date.setUTCFullYear(year);
  return date;
}

/** Date from a `@db.Date` column (UTC midnight) -> LocalDate. Throws if not UTC midnight. */
export function fromDbDate(date: Date): LocalDate {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error(`fromDbDate: invalid Date ${String(date)}`);
  }
  if (
    date.getUTCHours() !== 0 ||
    date.getUTCMinutes() !== 0 ||
    date.getUTCSeconds() !== 0 ||
    date.getUTCMilliseconds() !== 0
  ) {
    throw new Error(`fromDbDate: expected UTC midnight, got ${date.toISOString()}`);
  }
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
