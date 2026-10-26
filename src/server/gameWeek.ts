// Week helpers for the game leaderboard: a week starts Monday 00:00 America/Chicago.

import { addDays, localDateOf, weekdayOf } from "@/domain/dates";
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

export function previousWeekKey(weekKey: LocalDate): LocalDate {
  return addDays(weekKey, -7);
}

/** First 2 chars + *** + last 2 (ids of 4 characters or fewer: first char + ***). Code point safe. */
export function maskWechat(id: string): string {
  const cs = [...id.trim()];
  if (cs.length <= 4) return `${cs[0] ?? ""}***`;
  return `${cs.slice(0, 2).join("")}***${cs.slice(-2).join("")}`;
}
