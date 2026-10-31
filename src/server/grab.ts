// 兔兔夹面包 server (G2, D145). Mirrors TU run lifecycle, validation and leaderboard policy.

import type { GameRun } from "@/generated/prisma/client";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { copy } from "@/copy";
import type { Prisma } from "@/generated/prisma/client";
import { MAX_LAUNCHES, MAX_RUN_TICKS, createGrabGame, replayGrab, GRAB_ENGINE_VERSION,
  GrabReplayError, grabSeed, grabSeedVersion } from "@/lib/grab";
import { isGrabSuspicious, GRAB_MIN_TIERS, grabTiersFromSnapshot, launchTime, validLaunchTime } from "./grabRules";
export { isGrabSuspicious, GRAB_MIN_TIERS, GRAB_SUSPICIOUS_MEDIAN_GAP_MS, grabTiersFromSnapshot } from "./grabRules";
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

/** At most 6000 four-digit ticks plus commas, 25% headroom and a 4 KiB envelope. */
export const GRAB_MAX_FINISH_BODY_BYTES = Math.ceil(MAX_LAUNCHES * (String(MAX_RUN_TICKS).length + 1) * 1.25) + 4 * 1024;
export const grabStartSchema = startSchema;
export const grabFinishSchema = z.object({
  runId: z.uuid(),
  launches: z.array(z.number().int().min(0).max(MAX_RUN_TICKS)).max(MAX_LAUNCHES),
  endTick: z.number().int().min(0).max(MAX_RUN_TICKS),
});

/** The BIG game's configured bread tiers, in the same order, without its big bread. */
export async function loadGrabTiers(db: DbClient): Promise<GameTierConfig[]> {
  return (await loadTierConfigs(db)).filter((t) => t.id !== "big");
}

export async function startGrabRun(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<StartResult> {
  const data = parseGameInput(grabStartSchema, input);
  if (await isBanned(db, data.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned, extra: { fields: { wechatId: copy.gameApi.banned } } });
  }
  await rateLimit(db, `grab_start_ip:${ipHash}`, START_LIMIT_PER_HOUR, now);
  const tiers = await loadGrabTiers(db);
  // D145 requires at least three distinct bread photos.
  if (tiers.length < GRAB_MIN_TIERS) {
    throw new AppError("VALIDATION", { message: copy.gameApi.grabNotReady, extra: { fields: {} } });
  }
  // The seed carries the engine version (D145): finish refuses runs dealt under another version.
  const seed = grabSeed(randomBytes(16).toString("hex"));
  const run = await db.gameRun.create({
    data: {
      game: "GRAB",
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

export async function finishGrabRun(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<FinishResult> {
  const data = parseGameInput(grabFinishSchema, input);
  await rateLimit(db, `grab_finish_ip:${ipHash}`, FINISH_LIMIT_PER_HOUR, now);
  const run = await db.gameRun.findUnique({ where: { id: data.runId } });
  // Run ids from other games are not runs of this game.
  if (!run || run.game !== "GRAB") throw new AppError("NOT_FOUND", { message: copy.gameApi.runNotFound });
  // Repeating a finish returns the stored result (the first launch log wins).
  if (run.finishedAt) return resultFor(db, run, "GRAB");
  // A run dealt under another engine version (e.g. started before a rules change was deployed)
  // would replay under different rules: it can no longer be finished, like an expired run. Such
  // runs expire with the week anyway and are cleaned up as unfinished runs.
  if (now.getTime() >= runExpiresAt(run.startedAt).getTime() || grabSeedVersion(run.seed) !== GRAB_ENGINE_VERSION) {
    throw new AppError("VALIDATION", { message: copy.gameApi.runExpired });
  }
  if (await isBanned(db, run.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned });
  }
  const verified = verifyGrabRun(run, data, now);
  const weekKey = weekKeyOf(now);
  const claimed = await db.gameRun.updateMany({
    where: { id: run.id, finishedAt: null },
    data: {
      finishedAt: now,
      updatedAt: null,
      score: verified.score,
      weekKey,
      drops: data.launches as unknown as Prisma.InputJsonValue,
      dropCount: data.launches.length,
      playMs: verified.playMs,
      suspicious: verified.suspicious,
    },
  });
  if (claimed.count === 0) {
    const stored = await db.gameRun.findUniqueOrThrow({ where: { id: run.id } });
    return resultFor(db, stored, "GRAB");
  }
  return resultFor(db, { id: run.id, wechatId: run.wechatId, score: verified.score, weekKey }, "GRAB");
}

export function getGrabLeaderboard(db: DbClient, now: Date, myWechatId?: string | null): Promise<Leaderboard> {
  return getLeaderboard(db, now, myWechatId, "GRAB");
}

/** Shared finish/progress replay and active-time plausibility. Paused wall time is allowed. */
export function verifyGrabRun(run: GameRun, data: z.output<typeof grabFinishSchema>, now: Date) {
  const badRun = () => new AppError("VALIDATION", { message: copy.gameApi.badRun });
  let outcome;
  let deadline;
  try {
    const tiers = grabTiersFromSnapshot(run.tiersSnapshot);
    outcome = replayGrab(run.seed, tiers, data.launches, data.endTick);
    const game = createGrabGame({ seed: run.seed, tiers });
    for (const tick of data.launches) game.launch(tick);
    game.step(data.endTick);
    const state = game.state();
    deadline = state.tick + state.timeLeft;
  } catch (e) {
    if (e instanceof GrabReplayError || e instanceof RangeError) throw badRun();
    throw e;
  }
  const playMs = launchTime(data.endTick);
  if (data.launches.some(tick => !validLaunchTime(tick, launchTime(tick)))
    || playMs > now.getTime() - run.startedAt.getTime() + PLAUSIBILITY_SLACK_MS
    || playMs > launchTime(deadline) + PLAUSIBILITY_SLACK_MS
    || (run.playMs !== null && playMs < run.playMs)
    || (Array.isArray(run.drops) && !run.drops.every((tick, i) => tick === data.launches[i]))) throw badRun();
  return { score: outcome.score, playMs, suspicious: isGrabSuspicious(data.launches) };
}
