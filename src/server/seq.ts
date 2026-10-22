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
 * Next seq for `date`: increments and returns `OpenDate.lastSeq`, the highest number ever
 * handed out for that day. Numbers are never reused: cancelled orders keep theirs, and an
 * order moved to another day (D52) leaves its old number behind, unused.
 *
 * As a guard, the counter never goes below the highest seq actually on the day (rows
 * inserted without allocateSeq, e.g. test fixtures or manual repairs).
 *
 * MUST be called only after the OpenDate row of `date` is locked in the same transaction
 * (`lockOpenDate` / `lockOpenDates`), so concurrent creates and date-changing edits queue.
 * The increment rolls back with the transaction, so a failed create leaves no gap.
 * Throws if the date has no OpenDate row.
 */
export async function allocateSeq(tx: Tx, date: LocalDate): Promise<AllocatedSeq> {
  parseLocalDate(date);
  const rows = await tx.$queryRaw<{ lastSeq: number }[]>`
    UPDATE "OpenDate"
    SET "lastSeq" = GREATEST(
          "lastSeq",
          (SELECT COALESCE(MAX("seq"), 0) FROM "Order" WHERE "pickupDate" = ${toDbDate(date)}::date)
        ) + 1
    WHERE "date" = ${toDbDate(date)}::date
    RETURNING "lastSeq"`;
  const row = rows[0];
  if (!row) throw new Error(`allocateSeq: no OpenDate row for ${date}`);
  const seq = Number(row.lastSeq);
  return { seq, orderNo: formatOrderNo(date, seq) };
}
