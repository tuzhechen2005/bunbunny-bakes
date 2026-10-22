// Order cutoff (CAPACITY_RULES.md §6). Pure: `now` is always a parameter.
//
//   lead_days(cart) = max(leadDays of each product in the cart)
//   cutoff(cart, D) = (D − lead_days) at cutoffTime, America/Chicago
//   can order      ⇔ now < cutoff

import { TZDate } from "@date-fns/tz";
import { copy } from "@/copy";
import { SHOP_TZ, addDays, localDateOf, monthDay, parseLocalDate, weekdayOf } from "./dates";
import type { CartLine, LocalDate } from "./types";

const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseHm(hm: string): { hour: number; minute: number } {
  const m = typeof hm === "string" ? HM_RE.exec(hm) : null;
  if (!m) throw new Error(`Invalid cutoff time (expected HH:MM 00:00–23:59): ${JSON.stringify(hm)}`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** Max leadDays over the cart. Throws on an empty cart or an unknown product id. */
export function leadDaysOf(
  lines: CartLine[],
  products: Record<string, { leadDays: number }>,
): number {
  if (lines.length === 0) throw new Error("leadDaysOf: empty cart");
  let max = -Infinity;
  for (const line of lines) {
    if (!Object.prototype.hasOwnProperty.call(products, line.productId)) {
      throw new Error(`leadDaysOf: unknown product ${JSON.stringify(line.productId)}`);
    }
    max = Math.max(max, products[line.productId].leadDays);
  }
  return max;
}

/** (pickupDate − leadDays) at cutoffTime "HH:MM" in Chicago, as a UTC instant. */
export function cutoffAt(pickupDate: LocalDate, leadDays: number, cutoffTime: string): Date {
  parseLocalDate(pickupDate);
  if (!Number.isInteger(leadDays) || leadDays < 0) {
    throw new Error(`cutoffAt: leadDays must be a non-negative integer, got ${leadDays}`);
  }
  const { hour, minute } = parseHm(cutoffTime);
  const { year, month, day } = parseLocalDate(addDays(pickupDate, -leadDays));
  const z = new TZDate(year, month - 1, day, hour, minute, 0, 0, SHOP_TZ);
  return new Date(z.getTime());
}

/** Customers may order only while now < cutoff (strictly). */
export function isBeforeCutoff(now: Date, cutoff: Date): boolean {
  return now.getTime() < cutoff.getTime();
}

/** copy.dates.cutoffLabel in Chicago time, e.g. "10/29 周四 20:00 截止". */
export function cutoffLabel(cutoff: Date): string {
  const d = localDateOf(cutoff); // throws on an invalid Date
  const z = new TZDate(cutoff.getTime(), SHOP_TZ);
  const hm = `${String(z.getHours()).padStart(2, "0")}:${String(z.getMinutes()).padStart(2, "0")}`;
  return copy.dates.cutoffLabel
    .replace("{md}", monthDay(d))
    .replace("{weekday}", copy.dates.weekdays[weekdayOf(d)])
    .replace("{hm}", hm);
}
