import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
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

import { GRAB_ENGINE_VERSION, grabSeedVersion } from "@/lib/grab";
import { grabFinishSchema, verifyGrabRun } from "./grab";

const envelope = z.object({ runId: z.uuid(), log: z.unknown(), endTick: z.unknown().optional() });

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
    || (game === "M3" && m3SeedVersion(run.seed) !== M3_ENGINE_VERSION)
    || (game === "GRAB" && grabSeedVersion(run.seed) !== GRAB_ENGINE_VERSION)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.runExpired });
  }
  if (await isBanned(db, run.wechatId)) throw new AppError("VALIDATION", { message: copy.gameApi.banned });
  const field = game === "BIG" ? "drops" : game === "TU" ? "taps" : game === "GRAB" ? "launches" : "moves";
  const inputBody = { runId: run.id, [field]: data.log, endTick: data.endTick };
  const body = game === "BIG" ? parseGameInput(finishSchema, inputBody)
    : game === "TU" ? parseGameInput(tuFinishSchema, inputBody)
    : game === "GRAB" ? parseGameInput(grabFinishSchema, inputBody)
    : parseGameInput(m3FinishSchema, inputBody);
  const log = "drops" in body ? body.drops : "taps" in body ? body.taps : "launches" in body ? body.launches : body.moves;
  // Compare canonical evidence before paying for a replay of a stale/diverging report.
  if (Array.isArray(run.drops) && !samePrefix(run.drops, log)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.badRun });
  }
  const verified = "drops" in body ? verifyBigRun(run, body, now)
    : "taps" in body ? verifyTuRun(run, body, now)
    : "launches" in body ? verifyGrabRun(run, body, now)
    : verifyM3Run(run, body, now);
  // Initialize even a zero score, but idle reports must not move the tie-break time.
  const updatedAt = run.updatedAt === null || run.score === null || verified.score > run.score ? now : run.updatedAt;
  const saved = await db.gameRun.updateMany({
    where: { id: run.id, finishedAt: null, progressAttemptAt: now },
    data: { ...verified, updatedAt, weekKey: weekKeyOf(run.startedAt),
      drops: log, dropCount: log.length },
  });
  return { score: verified.score, live: saved.count > 0 };
}

function samePrefix(previous: unknown[], next: unknown): boolean {
  if (!Array.isArray(next) || next.length < previous.length) return false;
  return previous.every((entry, i) => isDeepStrictEqual(entry, next[i]));
}
