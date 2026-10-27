// Pickup weekdays (D115, CAPACITY_RULES §7 rule 2b). Pure.

import { weekdayOf } from "./dates";
import type { CapacityProduct, CartLine, LocalDate, Violation } from "./types";

export type WeekdayViolation = Extract<Violation, { kind: "WEEKDAY" }>;

/** Sorted, distinct; all seven days are stored as [] (= every day). Throws on anything outside 0–6. */
export function normalizeWeekdays(days: readonly number[]): number[] {
  for (const d of days) {
    if (!Number.isInteger(d) || d < 0 || d > 6) throw new Error(`weekdays: ${String(d)} is not 0–6`);
  }
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  return sorted.length === 7 ? [] : sorted;
}

/** Can this product be picked up on `date`? Absent / empty list = every day. */
export function allowsDate(product: Pick<CapacityProduct, "pickupWeekdays">, date: LocalDate): boolean {
  const days = product.pickupWeekdays;
  return !days || days.length === 0 || days.includes(weekdayOf(date));
}

/**
 * One WEEKDAY violation per product of `lines` that cannot be picked up on `date`, in cart
 * order. Lines of unknown products are skipped (other checks report them).
 */
export function weekdayViolations(
  date: LocalDate,
  lines: readonly CartLine[],
  products: Record<string, CapacityProduct>,
): WeekdayViolation[] {
  const seen = new Set<string>();
  const out: WeekdayViolation[] = [];
  for (const line of lines) {
    if (seen.has(line.productId) || !Object.prototype.hasOwnProperty.call(products, line.productId)) continue;
    seen.add(line.productId);
    const product = products[line.productId];
    if (!allowsDate(product, date)) {
      out.push({ kind: "WEEKDAY", date, productId: line.productId, weekdays: [...(product.pickupWeekdays ?? [])] });
    }
  }
  return out;
}
