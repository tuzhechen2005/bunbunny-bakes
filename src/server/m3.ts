// 兔兔三连烤 server (S2, D135). Mirrors TU run lifecycle, validation and leaderboard policy.

import type { GameRun } from "@/generated/prisma/client";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { copy } from "@/copy";
import type { Prisma } from "@/generated/prisma/client";
import { BOARD_SIZE, MAX_MOVES, MIN_MOVE_GAP_MS, replayM3, M3_ENGINE_VERSION,
  M3ReplayError, m3Seed, m3SeedVersion } from "@/lib/m3";
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
export const m3StartSchema = startSchema;

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

export async function startM3Run(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<StartResult> {
  const data = parseGameInput(m3StartSchema, input);
  if (await isBanned(db, data.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned, extra: { fields: { wechatId: copy.gameApi.banned } } });
  }
  await rateLimit(db, `m3_start_ip:${ipHash}`, START_LIMIT_PER_HOUR, now);
  const tiers = await loadM3Tiers(db);
  // Fewer tiers change the board distribution, so ranked games require all six.
  if (tiers.length < M3_MIN_TIERS) {
    throw new AppError("VALIDATION", { message: copy.gameApi.m3NotReady, extra: { fields: {} } });
  }
  // The seed carries the engine version (D135): finish refuses runs dealt under another version.
  const seed = m3Seed(randomBytes(16).toString("hex"));
  const run = await db.gameRun.create({
    data: {
      game: "M3",
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

export async function finishM3Run(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<FinishResult> {
  const data = parseGameInput(m3FinishSchema, input);
  await rateLimit(db, `m3_finish_ip:${ipHash}`, FINISH_LIMIT_PER_HOUR, now);
  const run = await db.gameRun.findUnique({ where: { id: data.runId } });
  // Run ids from BIG or TU are not runs of this game.
  if (!run || run.game !== "M3") throw new AppError("NOT_FOUND", { message: copy.gameApi.runNotFound });
  // Repeating a finish returns the stored result (the first move log wins).
  if (run.finishedAt) return resultFor(db, run, "M3");
  // A run dealt under another engine version (e.g. started before a rules change was deployed)
  // would replay under different rules: it can no longer be finished, like an expired run. Such
  // runs expire with the week anyway and are cleaned up as unfinished runs.
  if (now.getTime() >= runExpiresAt(run.startedAt).getTime() || m3SeedVersion(run.seed) !== M3_ENGINE_VERSION) {
    throw new AppError("VALIDATION", { message: copy.gameApi.runExpired });
  }
  if (await isBanned(db, run.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned });
  }
  const verified = verifyM3Run(run, data, now);
  const weekKey = weekKeyOf(now);
  const claimed = await db.gameRun.updateMany({
    where: { id: run.id, finishedAt: null },
    data: {
      finishedAt: now,
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
    return resultFor(db, stored, "M3");
  }
  return resultFor(db, { id: run.id, wechatId: run.wechatId, score: verified.score, weekKey }, "M3");
}

export function getM3Leaderboard(db: DbClient, now: Date, myWechatId?: string | null): Promise<Leaderboard> {
  return getLeaderboard(db, now, myWechatId, "M3");
}

/** Shared finish/progress replay and wall-clock validation. */
export function verifyM3Run(run: GameRun, data: z.output<typeof m3FinishSchema>, now: Date) {
  const badRun = () => new AppError("VALIDATION", { message: copy.gameApi.badRun });
  let outcome;
  try {
    outcome = replayM3(run.seed, m3TiersFromSnapshot(run.tiersSnapshot), data.moves);
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
