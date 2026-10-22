// Outbox sender (docs/NOTIFICATIONS.md §1, CLAUDE.md rule 7). Never throws.
//
// No database connection is held while rendering or calling the mail provider, so a
// slow or hanging provider can never starve order transactions of connections:
//   1. claim: one short statement locks the due PENDING row (FOR UPDATE SKIP LOCKED),
//      counts the attempt and pushes nextAttemptAt out by a lease, then commits;
//   2. render and send, outside any transaction;
//   3. finish: one short update to SENT, or failure bookkeeping (backoff / FAILED).
// Two senders cannot both claim a row while its lease runs. If a sender dies between
// claim and finish, the lease expires and the row is retried with the same
// Idempotency-Key, so the provider never delivers it twice. The finish is fenced by
// the claim's attempt number, so a late finisher never overwrites a newer claim.

import { after } from "next/server";
import type { DbClient } from "./db";
import { renderNotification, type NotificationToRender, type RenderedEmail } from "./emails";
import { getTransport, mailSecrets, ownerAddresses, redact, type MailTransport } from "./mailer";

/** Minutes to wait after the n-th failed attempt (index n − 1). */
export const BACKOFF_MINUTES = [1, 2, 5, 10, 30, 60, 120, 240] as const;
/** After this many attempts the notification is FAILED and never retried. */
export const MAX_ATTEMPTS = 8;
/** How long a claim keeps other senders away (render + a 10 s transport timeout fit easily). */
export const LEASE_MS = 2 * 60_000;
/** processOutbox stops starting new sends after this long (cron-job.org times out at 30 s). */
export const OUTBOX_BUDGET_MS = 20_000;
const MAX_ERROR_LENGTH = 500;
const GAVE_UP_ERROR = `gave up after ${MAX_ATTEMPTS} attempts; the last attempt did not finish`;

export type SendResult = "sent" | "failed" | "skipped";

export interface SendDeps {
  render?: (db: DbClient, notification: NotificationToRender, now: Date) => Promise<RenderedEmail>;
  transport?: MailTransport;
}

export function backoffMs(attempts: number): number {
  const i = Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1;
  return BACKOFF_MINUTES[i] * 60_000;
}

function errorText(e: unknown): string {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return redact(raw, mailSecrets()).slice(0, MAX_ERROR_LENGTH);
}

interface ClaimedRow {
  id: string;
  kind: NotificationToRender["kind"];
  dedupeKey: string;
  payload: unknown;
  /** Including this attempt. */
  attempts: number;
  status: "PENDING" | "FAILED";
}

/**
 * Claims notification `id` if it is PENDING, due and not being claimed right now.
 * A row whose attempts are already used up (a previous sender died before finishing)
 * is marked FAILED instead of being claimed.
 */
async function claim(db: DbClient, id: string, now: Date): Promise<ClaimedRow | null> {
  const lease = new Date(now.getTime() + LEASE_MS);
  const rows = await db.$queryRaw<ClaimedRow[]>`
    UPDATE "Notification" AS n SET
      "attempts" = CASE WHEN n."attempts" >= ${MAX_ATTEMPTS} THEN n."attempts" ELSE n."attempts" + 1 END,
      "nextAttemptAt" = ${lease},
      "status" = (CASE WHEN n."attempts" >= ${MAX_ATTEMPTS} THEN 'FAILED' ELSE 'PENDING' END)::"NotificationStatus",
      "lastError" = CASE WHEN n."attempts" >= ${MAX_ATTEMPTS} THEN ${GAVE_UP_ERROR} ELSE n."lastError" END,
      "payload" = CASE WHEN n."attempts" >= ${MAX_ATTEMPTS} AND n."kind" = 'PASSWORD_RESET'
                       THEN '{"scrubbed": true}'::jsonb ELSE n."payload" END
    WHERE n."id" = (
      SELECT "id" FROM "Notification"
      WHERE "id" = ${id}::uuid AND "status" = 'PENDING' AND "nextAttemptAt" <= ${now}
      FOR UPDATE SKIP LOCKED)
    RETURNING n."id"::text AS "id", n."kind"::text AS "kind", n."dedupeKey", n."payload",
              n."attempts", n."status"::text AS "status"`;
  return rows[0] ?? null;
}

async function recordFailure(db: DbClient, row: ClaimedRow, now: Date, e: unknown): Promise<void> {
  const lastError = errorText(e);
  const failed = row.attempts >= MAX_ATTEMPTS;
  console.warn(`outbox: notification ${row.id} attempt ${row.attempts} failed: ${lastError}`);
  await db.notification.updateMany({
    // Fenced by the claim: a newer claim (lease expired) owns the row now.
    where: { id: row.id, status: "PENDING", attempts: row.attempts },
    data: {
      lastError,
      nextAttemptAt: new Date(now.getTime() + backoffMs(row.attempts)),
      ...(failed ? { status: "FAILED" as const } : {}),
      // A reset link must not stay in the database once it will never be sent.
      ...(failed && row.kind === "PASSWORD_RESET" ? { payload: { scrubbed: true } } : {}),
    },
  });
}

/**
 * Sends notification `id` if it is PENDING, due (`nextAttemptAt <= now`) and not claimed
 * by another sender; otherwise returns "skipped". Every claimed attempt counts, whatever
 * fails afterwards; the 8th failure marks it FAILED.
 */
export async function sendNotification(
  db: DbClient,
  id: string,
  now: Date,
  deps: SendDeps = {},
): Promise<SendResult> {
  let row: ClaimedRow | null;
  try {
    row = await claim(db, id, now);
  } catch (e) {
    console.error(`outbox: claiming notification ${id} errored: ${errorText(e)}`);
    return "failed";
  }
  if (!row) return "skipped";
  if (row.status === "FAILED") {
    console.warn(`outbox: notification ${row.id}: ${GAVE_UP_ERROR}`);
    return "failed";
  }

  try {
    const render = deps.render ?? renderNotification;
    const email = await render(
      db,
      { id: row.id, kind: row.kind, dedupeKey: row.dedupeKey, payload: row.payload },
      now,
    );
    const transport = deps.transport ?? getTransport();
    await transport.send({
      ...ownerAddresses(),
      subject: email.subject,
      text: email.text,
      idempotencyKey: row.dedupeKey,
    });
    await db.notification.updateMany({
      // Fenced by the claim. FAILED is allowed: the row may have been given up while this
      // (confirmed) send was in flight, and it was delivered after all.
      where: { id: row.id, attempts: row.attempts, status: { in: ["PENDING", "FAILED"] } },
      data: {
        status: "SENT",
        sentAt: now,
        lastError: null,
        ...(row.kind === "PASSWORD_RESET" ? { payload: { scrubbed: true } } : {}),
      },
    });
    return "sent";
  } catch (e) {
    try {
      await recordFailure(db, row, now, e);
    } catch (e2) {
      // The attempt is already counted; the lease expires and the row is retried.
      console.error(`outbox: recording failure of ${row.id} errored: ${errorText(e2)}`);
    }
    return "failed";
  }
}

export interface OutboxCounts {
  sent: number;
  failed: number;
  skipped: number;
  /** Due but not started because the run's time budget was used up. */
  deferred: number;
}

export interface ProcessDeps extends SendDeps {
  /** Default OUTBOX_BUDGET_MS. */
  budgetMs?: number;
  /** Monotonic milliseconds, for the budget. Default performance.now. */
  clock?: () => number;
}

/**
 * Sends due PENDING notifications (oldest due first), at most `limit` per run, and
 * starts no new send once `budgetMs` has elapsed.
 */
export async function processOutbox(
  db: DbClient,
  now: Date,
  deps: ProcessDeps = {},
  limit = 20,
): Promise<OutboxCounts> {
  const clock = deps.clock ?? (() => performance.now());
  const budgetMs = deps.budgetMs ?? OUTBOX_BUDGET_MS;
  const started = clock();
  const due = await db.notification.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: { id: true },
  });
  const counts: OutboxCounts = { sent: 0, failed: 0, skipped: 0, deferred: 0 };
  for (let i = 0; i < due.length; i++) {
    if (clock() - started >= budgetMs) {
      counts.deferred = due.length - i;
      break;
    }
    counts[await sendNotification(db, due[i].id, now, deps)] += 1;
  }
  return counts;
}

/**
 * Schedules the send of a just-committed notification to run after the response
 * (Next's `after()`). Nothing here can affect the response: any error is logged, and
 * the cron (`/api/cron/outbox`) retries whatever was not sent.
 */
export function sendAfterResponse(db: DbClient, notificationId: string | null, now: Date): void {
  if (!notificationId) return;
  try {
    after(async () => {
      try {
        await sendNotification(db, notificationId, now);
      } catch (e) {
        console.error(`outbox: after-response send errored: ${errorText(e)}`);
      }
    });
  } catch (e) {
    // e.g. outside a request scope: leave it to the cron.
    console.error(`outbox: could not schedule send of ${notificationId}: ${errorText(e)}`);
  }
}
