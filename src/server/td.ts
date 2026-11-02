import { countItemUses } from "@/lib/td";
import { claimCoinFinish, inventory } from "./economy";
import { hasPassedLevel, nextGameLevel } from "./gameLevels";
// Weekly TD attempts (D151 / D152): server-derived levels, replayed completion and shared ranking.

import type { GameRun } from "@/generated/prisma/client";

import { z } from "zod";
import { copy } from "@/copy";
import type { Prisma } from "@/generated/prisma/client";
import { MAX_INPUTS, replayTd, TD_ENGINE_VERSION, tdLevel, tdSeedVersion, validTdInput, validTdTick, type TdInput, type TdLevel, type TdOptions } from "@/lib/td";
import { isTdSuspicious, tdTierCount } from "./tdRules";
import { isDeepStrictEqual } from "node:util";
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

export const TD_MAX_FINISH_BODY_BYTES = MAX_INPUTS * 100 + 4096;
export const tdStartSchema = startSchema.extend({ level: z.number().int().min(1).max(2_147_483_646).optional() });
export type TdStartResult = StartResult & Pick<TdLevel, "mapData" | "unlockedTowers" | "newlyUnlocked"> & { level: number; weekKey: string; inventory: Awaited<ReturnType<typeof inventory>> };
export type TdFinishResult = FinishResult & { level: number; passed: boolean };
export const tdFinishSchema = z.object({
  runId: z.uuid(),
  inputs: z.array(z.custom<TdInput>(validTdInput)).max(MAX_INPUTS),
  endTick: z.number().refine(validTdTick),
});

/** TierView photos, cheapest first. Unlinked game pieces retain owner order before priced breads. */
export async function loadTdTiers(db: DbClient): Promise<GameTierConfig[]> {
  const [tiers, rows, products] = await Promise.all([
    loadTierConfigs(db),
    db.gameTier.findMany({ include: { product: { select: { unitPriceCents: true } } } }),
    db.product.findMany({ select: { id: true, unitPriceCents: true } }),
  ]);
  const prices = new Map(products.map(p => [p.id, p.unitPriceCents]));
  for (const row of rows) if (row.product) prices.set(row.id, row.product.unitPriceCents);
  return tiers.filter(t => t.id !== "big").sort((a, b) => (prices.get(a.id) ?? -1) - (prices.get(b.id) ?? -1));
}

export async function startTdRun(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<TdStartResult> {
  const data = parseGameInput(tdStartSchema, input);
  if (await isBanned(db, data.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned, extra: { fields: { wechatId: copy.gameApi.banned } } });
  }
  await rateLimit(db, `td_start_ip:${ipHash}`, START_LIMIT_PER_HOUR, now);
  const weekKey = weekKeyOf(now);
  const level = data.level ?? await nextGameLevel(db, "TD", weekKey, data.wechatId);
  if (level > 1 && !await hasPassedLevel(db, "TD", weekKey, data.wechatId, level - 1)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.levelLocked });
  }
  const definition = tdLevel(weekKey, level);
  const tiers = await loadTdTiers(db);
  const { seed } = definition;
  const run = await db.gameRun.create({
    data: {
      game: "TD",
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
  return { mapData: definition.mapData, unlockedTowers: definition.unlockedTowers, newlyUnlocked: definition.newlyUnlocked, inventory: await inventory(db, data.wechatId), runId: run.id, seed, level, weekKey, tiers, expiresAt: runExpiresAt(now).toISOString() };
}

export async function finishTdRun(db: DbClient, input: unknown, ipHash: string, now: Date): Promise<TdFinishResult> {
  const data = parseGameInput(tdFinishSchema, input);
  await rateLimit(db, `td_finish_ip:${ipHash}`, FINISH_LIMIT_PER_HOUR, now);
  const run = await db.gameRun.findUnique({ where: { id: data.runId } });
  // Run ids from other games cannot submit TD evidence.
  if (!run || run.game !== "TD") throw new AppError("NOT_FOUND", { message: copy.gameApi.runNotFound });
  if (!run.level || tdSeedVersion(run.seed) !== TD_ENGINE_VERSION) throw new AppError("VALIDATION", { message: copy.gameApi.runExpired });
  // Repeating a finish returns the stored result (the first input log wins).
  if (run.finishedAt) return tdResult(db, run);
  if (now.getTime() >= runExpiresAt(run.startedAt).getTime()) {
    throw new AppError("VALIDATION", { message: copy.gameApi.runExpired });
  }
  if (await isBanned(db, run.wechatId)) {
    throw new AppError("VALIDATION", { message: copy.gameApi.banned });
  }
  // Items are checked against the live inventory; claimCoinFinish deducts them atomically.
  const verified = verifyTdRun(run, data, now, true, await inventory(db, run.wechatId));
  const passedAt = verified.passed ? now : null;
  const weekKey = weekKeyOf(now);
  const claimed = await claimCoinFinish(db, {
    where: { id: run.id, finishedAt: null },
    data: {
      finishedAt: now,
      passedAt,
      updatedAt: null,
      score: verified.score,
      weekKey,
      drops: data.inputs as unknown as Prisma.InputJsonValue,
      dropCount: data.inputs.length,
      playMs: verified.playMs,
      suspicious: verified.suspicious,
    },
  }, now, countItemUses(data.inputs));
  if (claimed.count === 0) {
    const stored = await db.gameRun.findUniqueOrThrow({ where: { id: run.id } });
    return tdResult(db, stored);
  }
  return tdResult(db, { ...run, score: verified.score, weekKey, passedAt });
}

async function tdResult(db: DbClient, run: GameRun): Promise<TdFinishResult> {
  return { ...await resultFor(db, run, "TD"), level: run.level!, passed: run.passedAt !== null };
}

export async function getTdLeaderboard(db: DbClient, now: Date, myWechatId?: string | null): Promise<Leaderboard & { nextLevel: number }> {
  const [board, nextLevel] = await Promise.all([getLeaderboard(db, now, myWechatId, "TD"), myWechatId ? nextGameLevel(db, "TD", weekKeyOf(now), myWechatId) : 1]);
  return { ...board, nextLevel };
}

/** Server derives the entire level; client scores, waves and win flags are ignored. */
export function verifyTdRun(run: GameRun, data: z.output<typeof tdFinishSchema>, now: Date, complete = false, itemsAllowed: TdOptions["itemsAllowed"] = {}) {
  const badRun = () => new AppError("VALIDATION", { message: copy.gameApi.badRun });
  let outcome;
  try {
    if (!run.level) throw badRun();
    const level = tdLevel(weekKeyOf(run.startedAt), run.level);
    if (run.seed !== level.seed) throw badRun();
    outcome = replayTd({ level, itemsAllowed, tierCount: tdTierCount(run.tiersSnapshot) }, data.inputs, data.endTick);
    if (outcome.tick !== data.endTick || (complete && !outcome.over)) throw badRun();
  } catch { throw badRun(); }
  // 3x is the fastest supported presentation speed. Pauses consume no simulation time.
  const playMs = Math.ceil(data.endTick * 1000 / 60);
  if (playMs / 3 > now.getTime() - run.startedAt.getTime() + PLAUSIBILITY_SLACK_MS
    || (run.playMs !== null && playMs < run.playMs)
    || (Array.isArray(run.drops) && !run.drops.every((v, i) => isDeepStrictEqual(v, data.inputs[i])))) throw badRun();
  return { itemsUsed: outcome.itemsUsed, score: outcome.wave, playMs, suspicious: isTdSuspicious(data.inputs), passed: outcome.passed };
}
