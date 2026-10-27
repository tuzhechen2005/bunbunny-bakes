// Periodic cleanup, run by /api/cron/outbox (API_SPEC §4, SECURITY §1). Idempotent.

import type { DbClient } from "./db";
import { weekKeyOf, weekStartInstant } from "./gameWeek";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CleanupCounts {
  rateLimitHits: number;
  adminSessions: number;
  passwordResets: number;
  ordersIpHashCleared: number;
}

export async function cleanup(db: DbClient, now: Date): Promise<CleanupCounts> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const rateLimitHits = await db.rateLimitHit.deleteMany({ where: { at: { lt: dayAgo } } });
  const adminSessions = await db.adminSession.deleteMany({ where: { expiresAt: { lte: now } } });
  const passwordResets = await db.passwordReset.deleteMany({ where: { expiresAt: { lt: dayAgo } } });
  // IP hashes are kept 24 hours, for rate limiting only (SECURITY §1). Raw SQL so
  // Order.updatedAt (the admin edit concurrency token) is not bumped.
  const ordersIpHashCleared = await db.$executeRaw`
    UPDATE "Order" SET "ipHash" = NULL
    WHERE "createdAt" < ${dayAgo} AND "ipHash" IS NOT NULL`;
  // Unfinished runs live until the weekly reset after their start (D111): drop the ones started
  // before this week's Monday 00:00 Chicago (expired, nothing refers to them).
  await db.gameRun.deleteMany({ where: { finishedAt: null, startedAt: { lt: weekStartInstant(weekKeyOf(now)) } } });
  // Game runs keep their IP hash for 24 hours too (not part of the reported counts).
  await db.gameRun.updateMany({ where: { startedAt: { lt: dayAgo }, ipHash: { not: null } }, data: { ipHash: null } });
  return {
    rateLimitHits: rateLimitHits.count,
    adminSessions: adminSessions.count,
    passwordResets: passwordResets.count,
    ordersIpHashCleared,
  };
}
