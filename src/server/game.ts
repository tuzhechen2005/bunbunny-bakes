// 消除大面包 server side (D100-D105): start a run, verify and store a finished one, leaderboard.
// The client score is never trusted: finish replays the drop log with the run's own seed and the
// tier snapshot taken at start (src/lib/game/replay.ts).

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { copy } from "@/copy";
import { Prisma } from "@/generated/prisma/client";
import { MAX_DROPS, MAX_STEPS, replay, ReplayError } from "@/lib/game";
import type { LocalDate } from "@/domain/types";
import type { DbClient } from "./db";
import { AppError } from "./errors";
import { loadTierConfigs, tierDefsFromSnapshot, type GameTierConfig } from "./gameTiers";
import { maskWechat, previousWeekKey, weekKeyOf, weekRange } from "./gameWeek";
import { WECHAT_MAX } from "./orderSchemas";

export const RUN_TTL_MS = 2 * 60 * 60 * 1000;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const START_LIMIT_PER_HOUR = 60;
export const FINISH_LIMIT_PER_HOUR = 60;
export const STEPS_PER_SECOND = 120;
/** Allowed excess of simulated time over the real time since start (network, rounding). */
export const PLAUSIBILITY_SLACK_MS = 10_000;
export const NICKNAME_MAX = 10;
export const LEADERBOARD_SIZE = 20;
/** Largest finish body we read (600 drops are about 20 KB). */
export const MAX_FINISH_BODY_BYTES = 64 * 1024;

const codePoints = (s: string) => [...s].length;
// Control, format (zero-width, bidi marks and overrides) and line/paragraph separator characters:
// invisible or spoofing characters have no place in a nickname.
const BAD_NICK = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const wechatId = z
  .string()
  .trim()
  .refine((s) => codePoints(s) >= 1 && codePoints(s) <= WECHAT_MAX, { message: copy.gameApi.wechatId });

const nickname = z
  .string()
  .trim()
  .refine((s) => codePoints(s) >= 1 && codePoints(s) <= NICKNAME_MAX && !BAD_NICK.test(s), {
    message: copy.gameApi.nickname,
  });

export const startSchema = z.object({ wechatId, nickname });

export const finishSchema = z.object({
  runId: z.uuid(),
  drops: z
    .array(z.object({ x: z.number().min(0).max(1), at: z.number().int().min(0).max(MAX_STEPS) }))
    .max(MAX_DROPS),
});

function fieldsOf(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_";
    fields[key] ??= issue.code === "custom" ? issue.message : copy.errors.VALIDATION;
  }
  return fields;
}

export function parseGameInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new AppError("VALIDATION", { extra: { fields: fieldsOf(r.error) } });
  return r.data;
}

/** Case-insensitive, like order WeChat ids (D92). */
export async function isBanned(db: DbClient, id: string): Promise<boolean> {
  // lower() = lower() on purpose: Prisma's insensitive `equals` is an ILIKE, where % and _ are wildcards.
  const rows = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "GameBan" WHERE lower("wechatId") = lower(${id.trim()})`;
  return rows[0].n > 0;
}

/** Eligibility for the weekly prize: any order that is not CANCELLED or REJECTED (case-insensitive id). */
export async function hasOrdered(db: DbClient, id: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "Order"
    WHERE lower("wechatId") = lower(${id.trim()}) AND status::text NOT IN ('CANCELLED', 'REJECTED')`;
  return rows[0].n > 0;
}

/** Counts a hit for the key inside a transaction and throws RATE_LIMITED past `limit` per hour. */
async function rateLimit(db: DbClient, key: string, limit: number, now: Date): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const hits = await tx.rateLimitHit.count({ where: { key, at: { gt: new Date(now.getTime() - RATE_WINDOW_MS) } } });
    if (hits >= limit) throw new AppError("RATE_LIMITED");
    await tx.rateLimitHit.create({ data: { key, at: now } });
  });
}

export interface StartResult {
  runId: string;
  seed: string;
  tiers: GameTierConfig[];
  expiresAt: string;
}

export async function startRun(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<StartResult> {
  const data = parseGameInput(startSchema, input);
  if (await isBanned(db, data.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned, extra: { fields: { wechatId: copy.gameApi.banned } } });
  }
  await rateLimit(db, `game_start_ip:${ipHash}`, START_LIMIT_PER_HOUR, now);
  const tiers = await loadTierConfigs(db);
  const seed = randomBytes(16).toString("hex");
  const run = await db.gameRun.create({
    data: {
      seed,
      wechatId: data.wechatId,
      nickname: data.nickname,
      tiersSnapshot: tiers as unknown as Prisma.InputJsonValue,
      startedAt: now,
      ipHash,
    },
  });
  return { runId: run.id, seed, tiers, expiresAt: new Date(now.getTime() + RUN_TTL_MS).toISOString() };
}

interface BoardRow {
  id: string;
  wechatId: string;
  nickname: string;
  score: number;
  finishedAt: Date;
  rank: number;
}

/** One row per WeChat id (their best run), ranked by score then earliest finish; hidden runs and banned ids excluded. */
function rankedSql(weekKey: string) {
  return Prisma.sql`
    WITH best AS (
      SELECT DISTINCT ON (lower(r."wechatId")) r.id, r."wechatId", r.nickname, r.score, r."finishedAt"
      FROM "GameRun" r
      WHERE r."weekKey" = ${weekKey} AND r."finishedAt" IS NOT NULL AND r.score IS NOT NULL AND NOT r.hidden
        AND NOT EXISTS (SELECT 1 FROM "GameBan" b WHERE lower(b."wechatId") = lower(r."wechatId"))
      ORDER BY lower(r."wechatId"), r.score DESC, r."finishedAt" ASC, r.id ASC
    ), ranked AS (
      SELECT id, "wechatId", nickname, score, "finishedAt",
             (ROW_NUMBER() OVER (ORDER BY score DESC, "finishedAt" ASC, id ASC))::int AS rank
      FROM best
    )`;
}

async function topOfWeek(db: DbClient, weekKey: string, limit: number): Promise<BoardRow[]> {
  return db.$queryRaw<BoardRow[]>`${rankedSql(weekKey)} SELECT * FROM ranked ORDER BY rank LIMIT ${limit}`;
}

async function rowOfPlayer(db: DbClient, weekKey: string, id: string): Promise<BoardRow | null> {
  const rows = await db.$queryRaw<BoardRow[]>`${rankedSql(weekKey)} SELECT * FROM ranked WHERE lower("wechatId") = lower(${id}) LIMIT 1`;
  return rows[0] ?? null;
}

export interface FinishResult {
  score: number;
  best: number;
  rank: number | null;
  week: { start: LocalDate; end: LocalDate };
}

async function resultFor(db: DbClient, run: { wechatId: string; score: number | null; weekKey: string | null }): Promise<FinishResult> {
  const weekKey = run.weekKey ?? weekKeyOf(new Date());
  const mine = await rowOfPlayer(db, weekKey, run.wechatId);
  const score = run.score ?? 0;
  return { score, best: mine?.score ?? score, rank: mine?.rank ?? null, week: weekRange(weekKey) };
}

export async function finishRun(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<FinishResult> {
  const data = parseGameInput(finishSchema, input);
  await rateLimit(db, `game_finish_ip:${ipHash}`, FINISH_LIMIT_PER_HOUR, now);
  const run = await db.gameRun.findUnique({ where: { id: data.runId } });
  if (!run) throw new AppError("NOT_FOUND", { message: copy.gameApi.runNotFound });
  // Repeating a finish returns the stored result (the first drop log wins).
  if (run.finishedAt) return resultFor(db, run);
  if (now.getTime() > run.startedAt.getTime() + RUN_TTL_MS) {
    throw new AppError("VALIDATION", { message: copy.gameApi.runExpired });
  }
  if (await isBanned(db, run.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned });
  }
  let outcome;
  try {
    outcome = replay(run.seed, tierDefsFromSnapshot(run.tiersSnapshot), data.drops);
  } catch (e) {
    if (e instanceof ReplayError) throw new AppError("VALIDATION", { message: copy.gameApi.badRun });
    throw e;
  }
  // A real client cannot simulate faster than real time: reject "computed offline, submitted at once".
  const playedSteps = outcome.over ? outcome.steps : (data.drops[data.drops.length - 1]?.at ?? 0);
  const elapsedMs = now.getTime() - run.startedAt.getTime();
  if ((playedSteps / STEPS_PER_SECOND) * 1000 > elapsedMs + PLAUSIBILITY_SLACK_MS) {
    throw new AppError("VALIDATION", { message: copy.gameApi.badRun });
  }
  // A run finished after Monday 00:00 (Chicago) counts for the new week, whenever it started.
  const weekKey = weekKeyOf(now);
  // Only one finisher wins the run; a concurrent duplicate reads the stored result.
  const claimed = await db.gameRun.updateMany({
    where: { id: run.id, finishedAt: null },
    data: {
      finishedAt: now,
      score: outcome.score,
      weekKey,
      drops: data.drops as unknown as Prisma.InputJsonValue,
      dropCount: data.drops.length,
      simSteps: outcome.steps,
    },
  });
  if (claimed.count === 0) {
    const stored = await db.gameRun.findUniqueOrThrow({ where: { id: run.id } });
    return resultFor(db, stored);
  }
  return resultFor(db, { wechatId: run.wechatId, score: outcome.score, weekKey });
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  wechatMasked: string;
  score: number;
}

export interface Leaderboard {
  week: { start: LocalDate; end: LocalDate };
  top: LeaderboardEntry[];
  lastWinner: { nickname: string; wechatMasked: string; score: number } | null;
  myBest?: number;
}

export async function getLeaderboard(db: DbClient, now: Date, myWechatId?: string | null): Promise<Leaderboard> {
  const weekKey = weekKeyOf(now);
  const rows = await topOfWeek(db, weekKey, LEADERBOARD_SIZE);
  const last = previousWeekKey(weekKey);
  // The owner's award (if any) names the winner; otherwise the top of last week.
  const award = await db.gameAward.findUnique({ where: { weekKey: last }, include: { run: true } });
  let lastWinner: Leaderboard["lastWinner"] = null;
  if (award?.run && award.run.score !== null) {
    lastWinner = { nickname: award.run.nickname, wechatMasked: maskWechat(award.run.wechatId), score: award.run.score };
  } else {
    const [w] = await topOfWeek(db, last, 1);
    if (w) lastWinner = { nickname: w.nickname, wechatMasked: maskWechat(w.wechatId), score: w.score };
  }
  const out: Leaderboard = {
    week: weekRange(weekKey),
    top: rows.map((r) => ({ rank: r.rank, nickname: r.nickname, wechatMasked: maskWechat(r.wechatId), score: r.score })),
    lastWinner,
  };
  const id = myWechatId?.trim();
  if (id && codePoints(id) <= WECHAT_MAX) {
    const mine = await rowOfPlayer(db, weekKey, id);
    if (mine) out.myBest = mine.score;
  }
  return out;
}
