// Per-day order sequence numbers (DATA_MODEL.md §4 step 7, D30).

import { parseLocalDate } from "@/domain/dates";
import type { LocalDate } from "@/domain/types";
import type { Tx } from "./db";
import { toDbDate } from "./dbDates";

export interface AllocatedSeq {
  seq: number;
  /** "MMDD-NNN", e.g. "1024-003"; NNN is zero-padded to at least 3 digits. */
  orderNo: string;
}

/** Display number for `seq` on pickup date `date`. */
export function formatOrderNo(date: LocalDate, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new Error(`formatOrderNo: bad seq ${seq}`);
  const { month, day } = parseLocalDate(date);
  const mmdd = String(month).padStart(2, "0") + String(day).padStart(2, "0");
  return `${mmdd}-${String(seq).padStart(3, "0")}`;
}

/**
 * Next seq for `date`: coalesce(max(seq), 0) + 1 over ALL orders of the day (any status,
 * so numbers are never reused).
 *
 * MUST be called only after the OpenDate row of `date` is locked in the same transaction
 * (`lockOpenDate` / `lockOpenDates`): that lock is what makes max + 1 safe against
 * concurrent creates and date-changing edits.
 */
export async function allocateSeq(tx: Tx, date: LocalDate): Promise<AllocatedSeq> {
  const agg = await tx.order.aggregate({
    where: { pickupDate: toDbDate(date) },
    _max: { seq: true },
  });
  const seq = (agg._max.seq ?? 0) + 1;
  return { seq, orderNo: formatOrderNo(date, seq) };
}
