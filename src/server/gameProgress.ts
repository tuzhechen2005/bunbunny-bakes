import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { GameKind } from "@/lib/gameCatalog";
import { PROGRESS_MIN_GAP_MS } from "@/lib/liveScores";
import { TU_ENGINE_VERSION, tuSeedVersion } from "@/lib/tu";
import { M3_ENGINE_VERSION, m3SeedVersion } from "@/lib/m3";
import { copy } from "@/copy";
import type { DbClient } from "./db";
import { AppError } from "./errors";
import { finishSchema, isBanned, parseGameInput, verifyBigRun } from "./game";
import { tuFinishSchema, verifyTuRun } from "./tu";
import { m3FinishSchema, verifyM3Run } from "./m3";
import { runExpiresAt, weekKeyOf } from "./gameWeek";
import { liveScoresEnabled } from "./liveScores";

const envelope = z.object({ runId: z.uuid(), log: z.unknown() });

/** Full replay only. Reserve the throttle before parsing/replaying the potentially large log. */
export async function progressRun(db: DbClient, game: GameKind, input: unknown, now: Date) {
  if (!liveScoresEnabled()) throw new AppError("NOT_FOUND");
  const data = parseGameInput(envelope, input);
  const claimed = await db.gameRun.updateMany({
    where: { id: data.runId, game, finishedAt: null, OR: [
      { progressAttemptAt: null }, { progressAttemptAt: { lte: new Date(+now - PROGRESS_MIN_GAP_MS) } },
    ] },
    data: { progressAttemptAt: now },
  });
  if (!claimed.count) {
    // Do not load a potentially 20,000-entry stored log on a throttled request.
    const stored = await db.gameRun.findUnique({ where: { id: data.runId }, select: { game: true, finishedAt: true, score: true } });
    if (!stored || stored.game !== game) throw new AppError("NOT_FOUND");
    if (stored.finishedAt) return { score: stored.score, live: false };
    throw new AppError("RATE_LIMITED");
  }
  const run = await db.gameRun.findUniqueOrThrow({ where: { id: data.runId } });
  if (run.finishedAt) return { score: run.score, live: false };
  if (now >= runExpiresAt(run.startedAt)
    || (game === "TU" && tuSeedVersion(run.seed) !== TU_ENGINE_VERSION)
    || (game === "M3" && m3SeedVersion(run.seed) !== M3_ENGINE_VERSION)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.runExpired });
  }
  if (await isBanned(db, run.wechatId)) throw new AppError("VALIDATION", { message: copy.gameApi.banned });
  const field = game === "BIG" ? "drops" : game === "TU" ? "taps" : "moves";
  const body = { runId: run.id, [field]: data.log };
  const verified = game === "BIG" ? verifyBigRun(run, parseGameInput(finishSchema, body), now)
    : game === "TU" ? verifyTuRun(run, parseGameInput(tuFinishSchema, body), now)
    : verifyM3Run(run, parseGameInput(m3FinishSchema, body), now);
  // A stale shorter report must never roll back a previously accepted prefix.
  if (Array.isArray(run.drops) && !samePrefix(run.drops, data.log)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.badRun });
  }
  const saved = await db.gameRun.updateMany({
    where: { id: run.id, finishedAt: null, progressAttemptAt: now },
    data: { ...verified, updatedAt: now, weekKey: weekKeyOf(run.startedAt),
      drops: data.log as Prisma.InputJsonValue, dropCount: (data.log as unknown[]).length },
  });
  return { score: verified.score, live: saved.count > 0 };
}

function samePrefix(previous: unknown[], next: unknown): boolean {
  if (!Array.isArray(next) || next.length < previous.length) return false;
  return previous.every((entry, i) => isDeepStrictEqual(entry, next[i]));
}
