// Shared M3/TD weekly level progression/ranking. No engine or prize policy lives here.
import { Prisma, type GameKind } from "@/generated/prisma/client";
import type { DbClient } from "./db";

export const isLevelGame = (game: GameKind) => game === "M3" || game === "TD";
export const boardScore = (game: GameKind) => isLevelGame(game) ? Prisma.sql`r.level` : Prisma.sql`r.score`;
export const boardTime = (game: GameKind) => isLevelGame(game) ? Prisma.sql`r."passedAt"` : Prisma.sql`COALESCE(r."finishedAt", r."updatedAt")`;
export const levelEligibility = (game: GameKind) => isLevelGame(game) ? Prisma.sql`r."passedAt" IS NOT NULL AND r.level IS NOT NULL` : Prisma.sql`TRUE`;

/** Progression uses verified passes even when a score is hidden from the public board.
 * Callers enforce the shared ban policy. Equality is literal and case-insensitive, never ILIKE.
 */
export async function nextGameLevel(db: DbClient, game: GameKind, weekKey: string, wechatId: string): Promise<number> {
  const rows = await db.$queryRaw<{ best: number | null }[]>`
    SELECT max(level)::int AS best FROM "GameRun"
    WHERE game = ${game}::"GameKind" AND "weekKey" = ${weekKey}
      AND lower("wechatId") = lower(${wechatId.trim()}) AND "passedAt" IS NOT NULL`;
  return (rows[0]?.best ?? 0) + 1;
}

export async function hasPassedLevel(db: DbClient, game: GameKind, weekKey: string, wechatId: string, level: number) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "GameRun" WHERE game = ${game}::"GameKind" AND "weekKey" = ${weekKey}
      AND lower("wechatId") = lower(${wechatId.trim()}) AND level = ${level} AND "passedAt" IS NOT NULL LIMIT 1`;
  return rows.length > 0;
}

/** Activity is orthogonal to ranking: playing N+1 never claims an unpassed level. */
export async function levelPlayerActive(db: DbClient, game: GameKind, weekKey: string, wechatId: string, now: Date, windowMs: number) {
  const rows = await db.$queryRaw<{ active: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM "GameRun" WHERE game = ${game}::"GameKind" AND "weekKey" = ${weekKey}
      AND lower("wechatId") = lower(${wechatId.trim()}) AND "finishedAt" IS NULL
      AND NOT hidden AND level IS NOT NULL AND "updatedAt" IS NOT NULL
      AND "progressAttemptAt" > ${new Date(+now - windowMs)} AND "progressAttemptAt" <= ${now}) AS active`;
  return rows[0]?.active ?? false;
}
