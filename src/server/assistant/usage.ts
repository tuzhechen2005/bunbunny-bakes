// 小小🐰 daily limits (D118): per IP hash 20 messages / Chicago day, whole site 500 / day.
// Counted atomically (INSERT … ON CONFLICT … RETURNING) BEFORE the upstream call, so
// concurrent requests can never both slip under a limit. Only counts are stored.

import { localDateOf } from "@/domain/dates";
import type { DbClient } from "../db";

export const VISITOR_DAILY_LIMIT = 20;
export const GLOBAL_DAILY_LIMIT = 500;
/** The global row's ipHash (a real hash is 64 hex chars, so it cannot collide). */
export const GLOBAL_KEY = "*";

async function bump(db: DbClient, day: string, key: string): Promise<number> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "AssistantUsage" ("day", "ipHash", "count")
    VALUES (${day}::date, ${key}, 1)
    ON CONFLICT ("day", "ipHash") DO UPDATE SET "count" = "AssistantUsage"."count" + 1
    RETURNING "count"`;
  return Number(rows[0].count);
}

export type UsageResult = { allowed: true; remaining: number } | { allowed: false };

/**
 * Counts one message for `ipHash` on today's Chicago day. A visitor over the limit does
 * not use up the global budget. `remaining` = this visitor's messages left today after
 * this one.
 */
export async function takeMessage(db: DbClient, ipHash: string, now: Date): Promise<UsageResult> {
  const day = localDateOf(now);
  const mine = await bump(db, day, ipHash);
  if (mine > VISITOR_DAILY_LIMIT) return { allowed: false };
  const all = await bump(db, day, GLOBAL_KEY);
  if (all > GLOBAL_DAILY_LIMIT) return { allowed: false };
  return { allowed: true, remaining: Math.max(0, VISITOR_DAILY_LIMIT - mine) };
}

/** Rows of days before today (Chicago): IP hashes are kept no longer than the day they count. */
export async function cleanupAssistantUsage(db: DbClient, now: Date): Promise<number> {
  return db.$executeRaw`DELETE FROM "AssistantUsage" WHERE "day" < ${localDateOf(now)}::date`;
}
