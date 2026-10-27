// Week helpers for the game leaderboard: a week starts Monday 00:00 America/Chicago.

import { TZDate } from "@date-fns/tz";
import { addDays, localDateOf, parseLocalDate, SHOP_TZ, weekdayOf } from "@/domain/dates";
import type { LocalDate } from "@/domain/types";

/** Monday (Chicago) of the week containing the instant, "YYYY-MM-DD". */
export function weekKeyOf(instant: Date): LocalDate {
  const today = localDateOf(instant);
  const back = (weekdayOf(today) + 6) % 7; // Monday = 0
  return addDays(today, -back);
}

/** `start` = Monday, `end` = the Sunday that closes the week (both inclusive, "YYYY-MM-DD"). */
export function weekRange(weekKey: LocalDate): { start: LocalDate; end: LocalDate } {
  return { start: weekKey, end: addDays(weekKey, 6) };
}

/** Monday 00:00 America/Chicago of the week `weekKey` as an instant (DST safe). */
export function weekStartInstant(weekKey: LocalDate): Date {
  const { year, month, day } = parseLocalDate(weekKey);
  return new Date(new TZDate(year, month - 1, day, 0, 0, 0, 0, SHOP_TZ).getTime());
}

/** The weekly reset that follows `startedAt` (next Monday 00:00 Chicago): a run can be finished before it (D111). */
export function runExpiresAt(startedAt: Date): Date {
  return weekStartInstant(addDays(weekKeyOf(startedAt), 7));
}

export function previousWeekKey(weekKey: LocalDate): LocalDate {
  return addDays(weekKey, -7);
}

/** First 2 chars + *** + last 2 (ids of 4 characters or fewer: first char + ***). Code point safe. */
export function maskWechat(id: string): string {
  const cs = [...id.trim()];
  if (cs.length <= 4) return `${cs[0] ?? ""}***`;
  return `${cs.slice(0, 2).join("")}***${cs.slice(-2).join("")}`;
}
