// Outbox sender (docs/NOTIFICATIONS.md §1, CLAUDE.md rule 7). Sends one PENDING
// notification under a row lock (FOR UPDATE SKIP LOCKED), so overlapping cron runs and
// the after-commit send never send the same notification twice. Never throws.

import { after } from "next/server";
import type { DbClient } from "./db";
import { renderNotification, type NotificationToRender, type RenderedEmail } from "./emails";
import { getTransport, mailSecrets, ownerAddresses, redact, type MailTransport } from "./mailer";

/** Minutes to wait after the n-th failed attempt (index n − 1). */
export const BACKOFF_MINUTES = [1, 2, 5, 10, 30, 60, 120, 240] as const;
/** After this many failed attempts the notification is FAILED and never retried. */
export const MAX_ATTEMPTS = 8;
const MAX_ERROR_LENGTH = 500;
/** The row lock is held while rendering and sending (transport timeout is 10 s). */
const SEND_TX_TIMEOUT_MS = 30_000;

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

interface LockedRow {
  id: string;
  kind: NotificationToRender["kind"];
  dedupeKey: string;
  payload: unknown;
  attempts: number;
}

/**
 * Sends notification `id` if it is PENDING, due (`nextAttemptAt <= now`) and not locked
 * by another sender; otherwise returns "skipped". Failures (render or send) are recorded
 * with backoff; the 8th failure marks it FAILED.
 */
export async function sendNotification(
  db: DbClient,
  id: string,
  now: Date,
  deps: SendDeps = {},
): Promise<SendResult> {
  try {
    return await db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<LockedRow[]>`
          SELECT "id"::text AS "id", "kind"::text AS "kind", "dedupeKey", "payload", "attempts"
          FROM "Notification"
          WHERE "id" = ${id}::uuid AND "status" = 'PENDING' AND "nextAttemptAt" <= ${now}
          FOR UPDATE SKIP LOCKED`;
        const row = rows[0];
        if (!row) return "skipped" as const;
        const attempts = row.attempts + 1;

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
        } catch (e) {
          const lastError = errorText(e);
          const failed = attempts >= MAX_ATTEMPTS;
          await tx.notification.update({
            where: { id: row.id },
            data: {
              attempts,
              lastError,
              nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
              ...(failed ? { status: "FAILED" as const } : {}),
              // A reset link must not stay in the database once it will never be sent.
              ...(failed && row.kind === "PASSWORD_RESET" ? { payload: { scrubbed: true } } : {}),
            },
          });
          console.warn(`outbox: notification ${row.id} attempt ${attempts} failed: ${lastError}`);
          return "failed" as const;
        }

        await tx.notification.update({
          where: { id: row.id },
          data: {
            status: "SENT",
            sentAt: now,
            attempts,
            lastError: null,
            ...(row.kind === "PASSWORD_RESET" ? { payload: { scrubbed: true } } : {}),
          },
        });
        return "sent" as const;
      },
      { timeout: SEND_TX_TIMEOUT_MS },
    );
  } catch (e) {
    console.error(`outbox: sending notification ${id} errored: ${errorText(e)}`);
    return "failed";
  }
}

export interface OutboxCounts {
  sent: number;
  failed: number;
  skipped: number;
}

/** Sends every due PENDING notification (oldest due first), at most `limit` per run. */
export async function processOutbox(
  db: DbClient,
  now: Date,
  deps: SendDeps = {},
  limit = 20,
): Promise<OutboxCounts> {
  const due = await db.notification.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: { id: true },
  });
  const counts: OutboxCounts = { sent: 0, failed: 0, skipped: 0 };
  for (const { id } of due) {
    counts[await sendNotification(db, id, now, deps)] += 1;
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
