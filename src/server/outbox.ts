// Notification outbox (CLAUDE.md rule 7): enqueue inside the business
// transaction, send after commit (sending is a separate module).

import { Prisma } from "@/generated/prisma/client";
import type { NotificationKind } from "@/generated/prisma/client";
import type { Tx } from "./db";

export interface EnqueueInput {
  kind: NotificationKind;
  /** e.g. `new_order:<orderId>`, `summary:2026-10-23`. */
  dedupeKey: string;
  payload: Prisma.InputJsonValue;
  now: Date;
}

export type EnqueueResult = { created: true; id: string } | { created: false };

/**
 * Inserts a PENDING notification due at `now`. If a notification with the same
 * dedupeKey already exists, nothing changes and `{ created: false }` is returned.
 * Uses ON CONFLICT DO NOTHING, so a duplicate never aborts the caller's transaction.
 */
export async function enqueueNotification(tx: Tx, input: EnqueueInput): Promise<EnqueueResult> {
  const payload = JSON.stringify(input.payload);
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "Notification" ("id", "kind", "dedupeKey", "payload", "status", "attempts", "nextAttemptAt", "createdAt")
    VALUES (gen_random_uuid(), ${input.kind}::"NotificationKind", ${input.dedupeKey}, ${payload}::jsonb,
            'PENDING', 0, ${input.now}, ${input.now})
    ON CONFLICT ("dedupeKey") DO NOTHING
    RETURNING "id"::text AS "id"`;
  const row = rows[0];
  return row ? { created: true, id: row.id } : { created: false };
}
