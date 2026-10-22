// AuditLog writes. Always called inside the transaction of the change it records.

import { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/domain/types";
import type { Tx } from "./db";

export interface AuditEntry {
  actor: Actor;
  /** e.g. "order.create", "order.status", "settings.update" (DATA_MODEL.md §1 AuditLog). */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  /** Required by callers for overrides and rejections. */
  reason?: string | null;
  at: Date;
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined || value === null) return Prisma.DbNull;
  // Round-trip through JSON so Dates become ISO strings and undefined fields drop out.
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<{ id: string }> {
  return tx.auditLog.create({
    data: {
      actor: entry.actor,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: toJson(entry.before),
      after: toJson(entry.after),
      reason: entry.reason ?? null,
      at: entry.at,
    },
    select: { id: true },
  });
}
