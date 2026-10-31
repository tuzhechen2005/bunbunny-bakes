import { hasPassedLevel, nextGameLevel } from "./gameLevels";
// Weekly M3 attempts (S9 / D151): deterministic deals, replayed completion and shared level ranking.

import type { GameRun } from "@/generated/prisma/client";

import { z } from "zod";
import { copy } from "@/copy";
import type { Prisma } from "@/generated/prisma/client";
import { BOARD_SIZE, MAX_MOVES, MIN_MOVE_GAP_MS, replayM3, M3_ENGINE_VERSION,
  M3ReplayError, m3Level, m3SeedVersion } from "@/lib/m3";
import { isM3Suspicious, M3_MIN_TIERS, m3TiersFromSnapshot } from "./m3Rules";
export { isM3Suspicious, M3_MIN_TIERS, M3_SUSPICIOUS_MEDIAN_GAP_MS, m3TiersFromSnapshot } from "./m3Rules";
import type { DbClient } from "./db";
import { AppError } from "./errors";
import {
  FINISH_LIMIT_PER_HOUR,
  getLeaderboard,
  isBanned,
  parseGameInput,
  PLAUSIBILITY_SLACK_MS,
  rateLimit,
  resultFor,
  START_LIMIT_PER_HOUR,
  startSchema,
  type FinishResult,
  type Leaderboard,
  type StartResult,
} from "./game";
import { loadTierConfigs, type GameTierConfig } from "./gameTiers";
import { runExpiresAt, weekKeyOf } from "./gameWeek";

/** MAX_MOVES compact entries (up to 60 bytes with week-long timestamps), 25% headroom,
 * plus 4 KiB for the JSON envelope; enforced by the shared readGameJson helper. */
export const M3_MAX_FINISH_BODY_BYTES = Math.ceil(MAX_MOVES * 60 * 1.25) + 4 * 1024;
export const m3StartSchema = startSchema.extend({ level: z.number().int().min(1).max(2_147_483_646).optional() });
export type M3StartResult = StartResult & { level: number; weekKey: string; moves: number; target: number; tierCount: number };
export type M3FinishResult = FinishResult & { level: number; passed: boolean };

const cell = z.strictObject({
  r: z.number().int().min(0).max(BOARD_SIZE - 1),
  c: z.number().int().min(0).max(BOARD_SIZE - 1),
});
export const m3FinishSchema = z.object({
  runId: z.uuid(),
  moves: z.array(z.strictObject({ a: cell, b: cell, at: z.number().int().min(0) })).max(MAX_MOVES),
});

/** The BIG game's configured bread tiers, in the same order, without its big bread. */
export async function loadM3Tiers(db: DbClient): Promise<GameTierConfig[]> {
  return (await loadTierConfigs(db)).filter((t) => t.id !== "big").slice(0, M3_MIN_TIERS);
}

export async function startM3Run(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<M3StartResult> {
  const data = parseGameInput(m3StartSchema, input);
  if (await isBanned(db, data.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned, extra: { fields: { wechatId: copy.gameApi.banned } } });
  }
  await rateLimit(db, `m3_start_ip:${ipHash}`, START_LIMIT_PER_HOUR, now);
  const weekKey = weekKeyOf(now);
  const level = data.level ?? await nextGameLevel(db, "M3", weekKey, data.wechatId);
  if (level > 1 && !await hasPassedLevel(db, "M3", weekKey, data.wechatId, level - 1)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.levelLocked });
  }
  const definition = m3Level(weekKey, level);
  const configured = await loadM3Tiers(db);
  const tiers = configured.slice(0, definition.tierCount);
  // Require enough configured art for every weekly level, then snapshot this level’s subset.
  if (configured.length < M3_MIN_TIERS) {
    throw new AppError("VALIDATION", { message: copy.gameApi.m3NotReady, extra: { fields: {} } });
  }
  // The seed carries the engine version (D135): finish refuses runs dealt under another version.
  const { seed } = definition;
  const run = await db.gameRun.create({
    data: {
      game: "M3",
      level,
      weekKey,
      seed,
      wechatId: data.wechatId,
      nickname: data.nickname,
      tiersSnapshot: tiers as unknown as Prisma.InputJsonValue,
      startedAt: now,
      ipHash,
    },
  });
  return { runId: run.id, ...definition, level, weekKey, tiers, expiresAt: runExpiresAt(now).toISOString() };
}

export async function finishM3Run(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<M3FinishResult> {
  const data = parseGameInput(m3FinishSchema, input);
  await rateLimit(db, `m3_finish_ip:${ipHash}`, FINISH_LIMIT_PER_HOUR, now);
  const run = await db.gameRun.findUnique({ where: { id: data.runId } });
  // Run ids from BIG or TU are not runs of this game.
  if (!run || run.game !== "M3") throw new AppError("NOT_FOUND", { message: copy.gameApi.runNotFound });
  if (!run.level || m3SeedVersion(run.seed) !== M3_ENGINE_VERSION) throw new AppError("VALIDATION", { message: copy.gameApi.runExpired });
  // Repeating a finish returns the stored result (the first move log wins).
  if (run.finishedAt) return m3Result(db, run);
  if (now.getTime() >= runExpiresAt(run.startedAt).getTime()) {
    throw new AppError("VALIDATION", { message: copy.gameApi.runExpired });
  }
  if (await isBanned(db, run.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned });
  }
  const verified = verifyM3Run(run, data, now, true);
  const passedAt = verified.score >= m3Level(weekKeyOf(run.startedAt), run.level).target ? now : null;
  const weekKey = weekKeyOf(now);
  const claimed = await db.gameRun.updateMany({
    where: { id: run.id, finishedAt: null },
    data: {
      finishedAt: now,
      passedAt,
      updatedAt: null,
      score: verified.score,
      weekKey,
      drops: data.moves as unknown as Prisma.InputJsonValue,
      dropCount: data.moves.length,
      playMs: verified.playMs,
      suspicious: verified.suspicious,
    },
  });
  if (claimed.count === 0) {
    const stored = await db.gameRun.findUniqueOrThrow({ where: { id: run.id } });
    return m3Result(db, stored);
  }
  return m3Result(db, { ...run, score: verified.score, weekKey, passedAt });
}

async function m3Result(db: DbClient, run: GameRun): Promise<M3FinishResult> {
  return { ...await resultFor(db, run, "M3"), level: run.level!, passed: run.passedAt !== null };
}

export async function getM3Leaderboard(db: DbClient, now: Date, myWechatId?: string | null): Promise<Leaderboard & { nextLevel: number }> {
  const [board, nextLevel] = await Promise.all([getLeaderboard(db, now, myWechatId, "M3"), myWechatId ? nextGameLevel(db, "M3", weekKeyOf(now), myWechatId) : 1]);
  return { ...board, nextLevel };
}

/** Shared finish/progress replay and wall-clock validation. */
export function verifyM3Run(run: GameRun, data: z.output<typeof m3FinishSchema>, now: Date, complete = false) {
  const badRun = () => new AppError("VALIDATION", { message: copy.gameApi.badRun });
  let outcome;
  try {
    if (!run.level) throw badRun();
    const level = m3Level(weekKeyOf(run.startedAt), run.level);
    const tiers = m3TiersFromSnapshot(run.tiersSnapshot);
    if (run.seed !== level.seed || tiers.length !== level.tierCount) throw badRun();
    outcome = replayM3(run.seed, tiers, data.moves, level);
    if (complete && !outcome.over) throw badRun();
  } catch (e) {
    if (e instanceof M3ReplayError) throw badRun();
    throw e;
  }
  // Plausibility: enforce the engine gap and bound client time by elapsed server time plus slack.
  for (let i = 1; i < data.moves.length; i++) {
    if (data.moves[i].at - data.moves[i - 1].at < MIN_MOVE_GAP_MS) throw badRun();
  }
  const playMs = data.moves[data.moves.length - 1]?.at ?? 0;
  if (playMs > now.getTime() - run.startedAt.getTime() + PLAUSIBILITY_SLACK_MS) throw badRun();
  return { score: outcome.score, playMs, suspicious: isM3Suspicious(data.moves) };
}
