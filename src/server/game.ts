// 消除大面包 server side (D100-D105): start a run, verify and store a finished one, leaderboard.
// The client score is never trusted: finish replays the drop log with the run's own seed and the
// tier snapshot taken at start (src/lib/game/replay.ts).
//
// The board helpers (weekly ranking, all-time record, personal best, award lookup) take a `game`
// so 兔了个兔 (src/server/tu.ts, D124) reuses them; the default is the first game.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { copy } from "@/copy";
import { Prisma } from "@/generated/prisma/client";
import { MAX_DROPS, MAX_STEPS, replay, ReplayError } from "@/lib/game";
import type { LocalDate } from "@/domain/types";
import type { DbClient } from "./db";
import { AppError } from "./errors";
import { loadTierConfigs, tierDefsFromSnapshot, type GameTierConfig } from "./gameTiers";
import { maskWechat, previousWeekKey, runExpiresAt, weekKeyOf, weekRange } from "./gameWeek";
import { WECHAT_MAX } from "./orderSchemas";

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

/** GameRun.game / GameAward.game (D124): BIG = 消除大面包, TU = 兔了个兔. */
export type GameKind = "BIG" | "TU";

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
export async function rateLimit(db: DbClient, key: string, limit: number, now: Date): Promise<void> {
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
  return { runId: run.id, seed, tiers, expiresAt: runExpiresAt(now).toISOString() };
}

export interface BoardRow {
  id: string;
  wechatId: string;
  nickname: string;
  score: number;
  finishedAt: Date;
  rank: number;
}

/** Finished, non-hidden runs of ids that are not banned: what the boards count. */
const ELIGIBLE = Prisma.sql`r."finishedAt" IS NOT NULL AND r.score IS NOT NULL AND NOT r.hidden
  AND NOT EXISTS (SELECT 1 FROM "GameBan" b WHERE lower(b."wechatId") = lower(r."wechatId"))`;

/** One row per WeChat id (their best run), ranked by score then earliest finish; hidden runs and banned ids excluded. */
function rankedSql(weekKey: string, game: GameKind) {
  return Prisma.sql`
    WITH best AS (
      SELECT DISTINCT ON (lower(r."wechatId")) r.id, r."wechatId", r.nickname, r.score, r."finishedAt"
      FROM "GameRun" r
      WHERE r.game = ${game}::"GameKind" AND r."weekKey" = ${weekKey} AND ${ELIGIBLE}
      ORDER BY lower(r."wechatId"), r.score DESC, r."finishedAt" ASC, r.id ASC
    ), ranked AS (
      SELECT id, "wechatId", nickname, score, "finishedAt",
             (ROW_NUMBER() OVER (ORDER BY score DESC, "finishedAt" ASC, id ASC))::int AS rank
      FROM best
    )`;
}

async function topOfWeek(db: DbClient, weekKey: string, limit: number, game: GameKind): Promise<BoardRow[]> {
  return db.$queryRaw<BoardRow[]>`${rankedSql(weekKey, game)} SELECT * FROM ranked ORDER BY rank LIMIT ${limit}`;
}

/** The whole ranked board of a week (full WeChat ids: server and owner use only). */
export async function rankedWeek(db: DbClient, weekKey: string, game: GameKind = "BIG"): Promise<BoardRow[]> {
  return db.$queryRaw<BoardRow[]>`${rankedSql(weekKey, game)} SELECT * FROM ranked ORDER BY rank`;
}

interface AllTimeRow {
  id: string;
  wechatId: string;
  nickname: string;
  score: number;
}

/** The all-time record (D113): highest eligible score ever, ties → earliest finish. */
async function allTimeRecord(db: DbClient, game: GameKind): Promise<AllTimeRow | null> {
  const rows = await db.$queryRaw<AllTimeRow[]>`
    SELECT r.id::text AS id, r."wechatId", r.nickname, r.score FROM "GameRun" r
    WHERE r.game = ${game}::"GameKind" AND ${ELIGIBLE}
    ORDER BY r.score DESC, r."finishedAt" ASC, r.id ASC LIMIT 1`;
  return rows[0] ?? null;
}

/** All-time best of a WeChat id (case-insensitive) over its finished, non-hidden runs. */
async function personalBestOf(db: DbClient, id: string, game: GameKind): Promise<number | null> {
  const rows = await db.$queryRaw<{ best: number | null }[]>`
    SELECT max(r.score)::int AS best FROM "GameRun" r
    WHERE r.game = ${game}::"GameKind" AND lower(r."wechatId") = lower(${id.trim()}) AND r."finishedAt" IS NOT NULL AND r.score IS NOT NULL AND NOT r.hidden`;
  return rows[0]?.best ?? null;
}

async function rowOfPlayer(db: DbClient, weekKey: string, id: string, game: GameKind): Promise<BoardRow | null> {
  const rows = await db.$queryRaw<BoardRow[]>`${rankedSql(weekKey, game)} SELECT * FROM ranked WHERE lower("wechatId") = lower(${id}) LIMIT 1`;
  return rows[0] ?? null;
}

export interface FinishResult {
  score: number;
  best: number;
  rank: number | null;
  week: { start: LocalDate; end: LocalDate };
  /** All-time best of this WeChat id, this run included (hidden runs do not count). */
  personalBest: number;
  /**
   * This run is the all-time record (`allTime` on the leaderboard). With the tie rule (earliest
   * finish wins) that means its score is strictly greater than every earlier eligible run, so it
   * is also true for the very first finished run. Recomputed on a repeated finish: false once beaten.
   */
  newRecord: boolean;
}

/** The finish result of a stored (or just claimed) run of `game`. */
export async function resultFor(
  db: DbClient,
  run: { id: string; wechatId: string; score: number | null; weekKey: string | null },
  game: GameKind = "BIG",
): Promise<FinishResult> {
  const weekKey = run.weekKey ?? weekKeyOf(new Date());
  const [mine, best, record] = await Promise.all([
    rowOfPlayer(db, weekKey, run.wechatId, game),
    personalBestOf(db, run.wechatId, game),
    allTimeRecord(db, game),
  ]);
  const score = run.score ?? 0;
  return {
    score,
    best: mine?.score ?? score,
    rank: mine?.rank ?? null,
    week: weekRange(weekKey),
    personalBest: Math.max(best ?? score, score),
    newRecord: record?.id === run.id,
  };
}

export async function finishRun(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<FinishResult> {
  const data = parseGameInput(finishSchema, input);
  await rateLimit(db, `game_finish_ip:${ipHash}`, FINISH_LIMIT_PER_HOUR, now);
  const run = await db.gameRun.findUnique({ where: { id: data.runId } });
  // A 兔了个兔 run id is not a run of this game.
  if (!run || run.game !== "BIG") throw new AppError("NOT_FOUND", { message: copy.gameApi.runNotFound });
  // Repeating a finish returns the stored result (the first drop log wins).
  if (run.finishedAt) return resultFor(db, run);
  // A run lives until the weekly reset after its start (D111): it always counts for its own week.
  if (now.getTime() >= runExpiresAt(run.startedAt).getTime()) {
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
  // Same as the start's week, since a run cannot be finished after the reset.
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
  return resultFor(db, { id: run.id, wechatId: run.wechatId, score: outcome.score, weekKey });
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
  /** 👑 all-time record (D113); null before the first eligible run. */
  allTime: { nickname: string; wechatMasked: string; score: number } | null;
  myBest?: number;
}

export async function getLeaderboard(
  db: DbClient,
  now: Date,
  myWechatId?: string | null,
  game: GameKind = "BIG",
): Promise<Leaderboard> {
  const weekKey = weekKeyOf(now);
  const [rows, record] = await Promise.all([topOfWeek(db, weekKey, LEADERBOARD_SIZE, game), allTimeRecord(db, game)]);
  const last = previousWeekKey(weekKey);
  // The owner's award (if any) names the winner; otherwise the top of last week.
  const award = await db.gameAward.findUnique({ where: { game_weekKey: { game, weekKey: last } }, include: { run: true } });
  let lastWinner: Leaderboard["lastWinner"] = null;
  if (award?.run && award.run.score !== null) {
    lastWinner = { nickname: award.run.nickname, wechatMasked: maskWechat(award.run.wechatId), score: award.run.score };
  } else {
    const [w] = await topOfWeek(db, last, 1, game);
    if (w) lastWinner = { nickname: w.nickname, wechatMasked: maskWechat(w.wechatId), score: w.score };
  }
  const out: Leaderboard = {
    week: weekRange(weekKey),
    top: rows.map((r) => ({ rank: r.rank, nickname: r.nickname, wechatMasked: maskWechat(r.wechatId), score: r.score })),
    lastWinner,
    allTime: record ? { nickname: record.nickname, wechatMasked: maskWechat(record.wechatId), score: record.score } : null,
  };
  const id = myWechatId?.trim();
  if (id && codePoints(id) <= WECHAT_MAX) {
    const mine = await rowOfPlayer(db, weekKey, id, game);
    if (mine) out.myBest = mine.score;
  }
  return out;
}
