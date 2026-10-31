// Dawn delivery RUN server (R3, D146). Mirrors TU run lifecycle, validation and leaderboard policy.

import type { GameRun } from "@/generated/prisma/client";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { copy } from "@/copy";
import type { Prisma } from "@/generated/prisma/client";
import { MAX_INPUTS, MAX_RUN_TICKS, replayRun, RUN_ENGINE_VERSION,
  RunReplayError, runSeed, runSeedVersion } from "@/lib/run";
import { isRunSuspicious, inputTime } from "./runRules";
export { isRunSuspicious, RUN_SUSPICIOUS_MEDIAN_GAP_MS } from "./runRules";
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
} from "./game";
import { runExpiresAt, weekKeyOf } from "./gameWeek";

/** Worst-case compact input object plus comma, 25% whitespace headroom and a 4 KiB envelope. */
export const RUN_MAX_FINISH_BODY_BYTES = Math.ceil(MAX_INPUTS * (JSON.stringify({ tick: MAX_RUN_TICKS, dir: "L" }).length + 1) * 1.25) + 4 * 1024;
export const runStartSchema = startSchema;
export const runFinishSchema = z.object({
  runId: z.uuid(),
  inputs: z.array(z.object({ tick: z.number().int().min(0).max(MAX_RUN_TICKS), dir: z.enum(["L", "R", "U", "D"]) }).strict()).max(MAX_INPUTS),
  endTick: z.number().int().min(0).max(MAX_RUN_TICKS),
});

export async function startRun(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<{ runId: string; seed: string; expiresAt: string }> {
  const data = parseGameInput(runStartSchema, input);
  if (await isBanned(db, data.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned, extra: { fields: { wechatId: copy.gameApi.banned } } });
  }
  await rateLimit(db, `run_start_ip:${ipHash}`, START_LIMIT_PER_HOUR, now);
  const seed = runSeed(randomBytes(16).toString("hex"));
  const run = await db.gameRun.create({
    data: {
      game: "RUN",
      seed,
      wechatId: data.wechatId,
      nickname: data.nickname,
      tiersSnapshot: [],
      startedAt: now,
      ipHash,
    },
  });
  return { runId: run.id, seed, expiresAt: runExpiresAt(now).toISOString() };
}

export async function finishRun(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<FinishResult> {
  const data = parseGameInput(runFinishSchema, input);
  await rateLimit(db, `run_finish_ip:${ipHash}`, FINISH_LIMIT_PER_HOUR, now);
  const run = await db.gameRun.findUnique({ where: { id: data.runId } });
  // Run ids from other games are not runs of this game.
  if (!run || run.game !== "RUN") throw new AppError("NOT_FOUND", { message: copy.gameApi.runNotFound });
  // Repeating a finish returns the stored result (the first input log wins).
  if (run.finishedAt) return resultFor(db, run, "RUN");
  // A run dealt under another engine version (e.g. started before a rules change was deployed)
  // would replay under different rules: it can no longer be finished, like an expired run. Such
  // runs expire with the week anyway and are cleaned up as unfinished runs.
  if (now.getTime() >= runExpiresAt(run.startedAt).getTime() || runSeedVersion(run.seed) !== RUN_ENGINE_VERSION) {
    throw new AppError("VALIDATION", { message: copy.gameApi.runExpired });
  }
  if (await isBanned(db, run.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned });
  }
  const verified = verifyRun(run, data, now);
  const weekKey = weekKeyOf(now);
  const claimed = await db.gameRun.updateMany({
    where: { id: run.id, finishedAt: null },
    data: {
      finishedAt: now,
      updatedAt: null,
      score: verified.score,
      weekKey,
      drops: data.inputs as unknown as Prisma.InputJsonValue,
      dropCount: data.inputs.length,
      playMs: verified.playMs,
      suspicious: verified.suspicious,
    },
  });
  if (claimed.count === 0) {
    const stored = await db.gameRun.findUniqueOrThrow({ where: { id: run.id } });
    return resultFor(db, stored, "RUN");
  }
  return resultFor(db, { id: run.id, wechatId: run.wechatId, score: verified.score, weekKey }, "RUN");
}

export function getRunLeaderboard(db: DbClient, now: Date, myWechatId?: string | null): Promise<Leaderboard> {
  return getLeaderboard(db, now, myWechatId, "RUN");
}

/** Shared finish/progress replay and active-time plausibility. Paused wall time is allowed. */
export function verifyRun(run: GameRun, data: z.output<typeof runFinishSchema>, now: Date) {
  const badRun = () => new AppError("VALIDATION", { message: copy.gameApi.badRun });
  let outcome;
  try {
    outcome = replayRun(run.seed, data.inputs, data.endTick);
  } catch (e) {
    if (e instanceof RunReplayError) throw badRun();
    throw e;
  }
  const playMs = inputTime(data.endTick);
  const wallMs = Math.min(now.getTime(), runExpiresAt(run.startedAt).getTime()) - run.startedAt.getTime();
  if (outcome.endTick !== data.endTick
    || playMs > wallMs + PLAUSIBILITY_SLACK_MS
    || (run.playMs !== null && playMs < run.playMs)
    || (Array.isArray(run.drops) && !run.drops.every((entry, i) => {
      const prior = entry as { tick?: unknown; dir?: unknown } | null;
      return prior?.tick === data.inputs[i]?.tick && prior?.dir === data.inputs[i]?.dir;
    }))) throw badRun();
  return { score: outcome.score, playMs, suspicious: isRunSuspicious(data.inputs, data.endTick) };
}
