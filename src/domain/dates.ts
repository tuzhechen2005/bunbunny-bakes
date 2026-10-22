// Calendar-day helpers for the shop's timezone. Pure: the current instant is
// always a parameter, and nothing depends on the machine's local timezone.

import { TZDate } from "@date-fns/tz";
import { copy } from "@/copy";
import type { LocalDate } from "./types";

export const SHOP_TZ = "America/Chicago";

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface Ymd {
  year: number;
  month: number; // 1-12
  day: number;
}

function tryParse(s: string): Ymd | null {
  const m = LOCAL_DATE_RE.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  // Day 0 of the next month = last day of this month (UTC arithmetic, no local TZ).
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return { year, month, day };
}

/** Parses a LocalDate or throws. */
export function parseLocalDate(d: LocalDate): Ymd {
  const ymd = tryParse(d);
  if (!ymd) throw new Error(`Invalid LocalDate: ${JSON.stringify(d)}`);
  return ymd;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function format(year: number, month: number, day: number): LocalDate {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/** UTC midnight of the calendar day; used only for calendar arithmetic. */
function utcMs({ year, month, day }: Ymd): number {
  return Date.UTC(year, month - 1, day);
}

/** Strict YYYY-MM-DD that names a real calendar day. */
export function isLocalDate(s: string): boolean {
  return typeof s === "string" && tryParse(s) !== null;
}

/** Pure calendar arithmetic: `n` days after `d` (negative goes back). */
export function addDays(d: LocalDate, n: number): LocalDate {
  if (!Number.isInteger(n)) throw new Error(`addDays: n must be an integer, got ${n}`);
  const t = new Date(utcMs(parseLocalDate(d)) + n * MS_PER_DAY);
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** <0 if a is before b, 0 if equal, >0 if after. */
export function compareLocalDate(a: LocalDate, b: LocalDate): number {
  return Math.sign(utcMs(parseLocalDate(a)) - utcMs(parseLocalDate(b)));
}

function assertValidInstant(instant: Date): void {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new Error("Invalid Date");
  }
}

/** The Chicago calendar day containing the instant. */
export function localDateOf(instant: Date): LocalDate {
  assertValidInstant(instant);
  const z = new TZDate(instant.getTime(), SHOP_TZ);
  return format(z.getFullYear(), z.getMonth() + 1, z.getDate());
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(d: LocalDate): number {
  return new Date(utcMs(parseLocalDate(d))).getUTCDay();
}

/** "M/D" without zero padding, e.g. "11/1". */
export function monthDay(d: LocalDate): string {
  const { month, day } = parseLocalDate(d);
  return `${month}/${day}`;
}

/** copy.dates.dayLabel, e.g. "10/30 周五", "11/1 周日". */
export function dayLabel(d: LocalDate): string {
  return copy.dates.dayLabel
    .replace("{md}", monthDay(d))
    .replace("{weekday}", copy.dates.weekdays[weekdayOf(d)]);
}
