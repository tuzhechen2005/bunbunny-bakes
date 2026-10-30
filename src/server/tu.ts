// 兔了个兔 server side (D121-D124, contract C6): start a run, verify and store a finished one,
// leaderboard. Same rules as 消除大面包 (src/server/game.ts): one-time seed, rate limits, a run
// lives until the weekly reset after its start, the tap log is replayed with the run's own seed
// and tier snapshot (src/lib/tu/replay.ts), weekly board = best per WeChat id, shared ban list.

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { copy } from "@/copy";
import { Prisma } from "@/generated/prisma/client";
import {
  MAX_TAPS,
  MAX_TIERS,
  MIN_TAP_GAP_MS,
  MIN_TIERS,
  replayTu,
  TU_ENGINE_VERSION,
  TU_PROPS,
  TuReplayError,
  tuSeed,
  tuSeedVersion,
  type TuLogEntry,
  type TuProp,
  type TuTierInput,
} from "@/lib/tu";
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

/**
 * Largest finish body we read: MAX_TAPS log entries of at most ~30 bytes each (a tap
 * `{"id":123,"at":604800000}` or a prop use `{"p":"swap","at":604800000}`), plus 25% headroom and 4 KiB for the envelope.
 */
export const TU_MAX_FINISH_BODY_BYTES = Math.ceil(MAX_TAPS * 30 * 1.25) + 4 * 1024;
/** Owner flag (D103 manual check): a median gap between taps under this (ms) looks scripted. */
export const SUSPICIOUS_MEDIAN_GAP_MS = 300;

export const tuStartSchema = startSchema;

const at = z.number().int().min(0);
/** One log entry (C8): a tile tap `{ id, at }` or a prop use `{ p, at }`, nothing else. */
const tuLogEntry = z.union([
  z.strictObject({ id: z.number().int().min(0), at }),
  z.strictObject({ p: z.enum(TU_PROPS as [TuProp, ...TuProp[]]), at }),
]);

export const tuFinishSchema = z.object({
  runId: z.uuid(),
  taps: z.array(tuLogEntry).max(MAX_TAPS),
});

/** The bread tiers of the first game (D123): its configured tiers without the 大面包. */
export async function loadTuTiers(db: DbClient): Promise<GameTierConfig[]> {
  return (await loadTierConfigs(db)).filter((t) => t.id !== "big").slice(0, MAX_TIERS);
}

/** Reads a TU run's tier snapshot (ids only matter to the engine); throws when it is not valid. */
export function tuTiersFromSnapshot(snapshot: unknown): TuTierInput[] {
  if (!Array.isArray(snapshot) || snapshot.length < MIN_TIERS || snapshot.length > MAX_TIERS) {
    throw new Error("bad tu tiers snapshot");
  }
  return snapshot.map((t) => {
    const o = t as { id?: unknown } | null;
    if (!o || typeof o.id !== "string" || o.id === "big") throw new Error("bad tu tiers snapshot");
    return { id: o.id };
  });
}

/** D103 owner flag: the run hit MAX_TAPS, or half its taps came less than 300 ms after the previous one. */
export function isSuspicious(taps: readonly TuLogEntry[]): boolean {
  if (taps.length >= MAX_TAPS) return true;
  if (taps.length < 2) return false;
  const gaps = taps
    .slice(1)
    .map((t, i) => t.at - taps[i].at)
    .sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return median < SUSPICIOUS_MEDIAN_GAP_MS;
}

export async function startTuRun(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<StartResult> {
  const data = parseGameInput(tuStartSchema, input);
  if (await isBanned(db, data.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned, extra: { fields: { wechatId: copy.gameApi.banned } } });
  }
  await rateLimit(db, `tu_start_ip:${ipHash}`, START_LIMIT_PER_HOUR, now);
  const tiers = await loadTuTiers(db);
  // The default tiers can fall back to a single product (a shop with one active product).
  if (tiers.length < MIN_TIERS) {
    throw new AppError("VALIDATION", { message: copy.gameApi.tuNotReady, extra: { fields: {} } });
  }
  // The seed carries the engine version (C8): finish refuses runs dealt under another version.
  const seed = tuSeed(randomBytes(16).toString("hex"));
  const run = await db.gameRun.create({
    data: {
      game: "TU",
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

export async function finishTuRun(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<FinishResult> {
  const data = parseGameInput(tuFinishSchema, input);
  await rateLimit(db, `tu_finish_ip:${ipHash}`, FINISH_LIMIT_PER_HOUR, now);
  const run = await db.gameRun.findUnique({ where: { id: data.runId } });
  // A 消除大面包 run id is not a run of this game.
  if (!run || run.game !== "TU") throw new AppError("NOT_FOUND", { message: copy.gameApi.runNotFound });
  // Repeating a finish returns the stored result (the first tap log wins).
  if (run.finishedAt) return resultFor(db, run, "TU");
  // A run dealt under another engine version (e.g. started before a rules change was deployed)
  // would replay under different rules: it can no longer be finished, like an expired run. Such
  // runs expire with the week anyway and are cleaned up as unfinished runs.
  if (now.getTime() >= runExpiresAt(run.startedAt).getTime() || tuSeedVersion(run.seed) !== TU_ENGINE_VERSION) {
    throw new AppError("VALIDATION", { message: copy.gameApi.runExpired });
  }
  if (await isBanned(db, run.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned });
  }
  const badRun = () => new AppError("VALIDATION", { message: copy.gameApi.badRun });
  let outcome;
  try {
    outcome = replayTu(run.seed, tuTiersFromSnapshot(run.tiersSnapshot), data.taps);
  } catch (e) {
    if (e instanceof TuReplayError) throw badRun();
    throw e;
  }
  // Plausibility: no two taps closer than a human can tap, and no more client time than real time.
  for (let i = 1; i < data.taps.length; i++) {
    if (data.taps[i].at - data.taps[i - 1].at < MIN_TAP_GAP_MS) throw badRun();
  }
  const playMs = data.taps[data.taps.length - 1]?.at ?? 0;
  if (playMs > now.getTime() - run.startedAt.getTime() + PLAUSIBILITY_SLACK_MS) throw badRun();
  const weekKey = weekKeyOf(now);
  const claimed = await db.gameRun.updateMany({
    where: { id: run.id, finishedAt: null },
    data: {
      finishedAt: now,
      score: outcome.score,
      weekKey,
      drops: data.taps as unknown as Prisma.InputJsonValue,
      dropCount: data.taps.length,
      playMs,
      suspicious: isSuspicious(data.taps),
    },
  });
  if (claimed.count === 0) {
    const stored = await db.gameRun.findUniqueOrThrow({ where: { id: run.id } });
    return resultFor(db, stored, "TU");
  }
  return resultFor(db, { id: run.id, wechatId: run.wechatId, score: outcome.score, weekKey }, "TU");
}

export function getTuLeaderboard(db: DbClient, now: Date, myWechatId?: string | null): Promise<Leaderboard> {
  return getLeaderboard(db, now, myWechatId, "TU");
}
