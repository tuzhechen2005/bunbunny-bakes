import { randomInt } from "node:crypto";
import { z } from "zod";
import { addDays } from "@/domain/dates";
import type { LocalDate } from "@/domain/types";
import { eligiblePrizeGames, M3_PRIZE_FROM_WEEK, GRAB_PRIZE_FROM_WEEK, RUN_PRIZE_FROM_WEEK } from "@/lib/gamePrizePool";
import { GAME_CATALOG } from "@/lib/gameCatalog";
import { loadTierConfigs } from "./gameTiers";
import { AppError } from "./errors";
import { copy } from "@/copy";
import { writeAudit } from "./audit";
import type { DbClient, Tx } from "./db";
import { parseGameInput } from "./game";
import { previousWeekKey, weekKeyOf } from "./gameWeek";

const enabledKinds = GAME_CATALOG.map((g) => g.kind);
export const prizeBodySchema = z.object({ game: z.enum(enabledKinds) }).strict();

// One lock across weeks also serializes a delayed cron with the new week's first request.
async function lockPrizeWeeks(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('game-prize-weeks'))`;
}

/** Lazy weekly draw; the primary key and lock guarantee one durable choice under concurrency. */
export async function getPrizeWeek(db: DbClient, now: Date, weekKey: LocalDate = weekKeyOf(now)) {
  const existing = await db.gamePrizeWeek.findUnique({ where: { weekKey } });
  if (existing) return existing;
  const tiers = (weekKey >= M3_PRIZE_FROM_WEEK || weekKey >= GRAB_PRIZE_FROM_WEEK) ? await loadTierConfigs(db) : [];
  const eligible = eligiblePrizeGames(weekKey, tiers.filter(t => t.id !== "big").length);
  return db.$transaction(async (tx) => {
    await lockPrizeWeeks(tx);
    const prior = await tx.gamePrizeWeek.findUnique({ where: { weekKey } });
    if (prior) return prior;
    const last = await tx.gamePrizeWeek.findUnique({ where: { weekKey: previousWeekKey(weekKey) } });
    // A deployment may first see the new week, then the cron for the closed week.
    const next = await tx.gamePrizeWeek.findUnique({ where: { weekKey: addDays(weekKey, 7) } });
    const candidates = eligible.filter((game) => game !== last?.game && game !== next?.game);
    // An owner may have chosen incompatible neighbours. Honour the preceding week's exclusion.
    const pool = candidates.length ? candidates : eligible.filter((game) => game !== last?.game);
    if (!pool.length) throw new Error("At least two enabled games are required for weekly prizes");
    return tx.gamePrizeWeek.create({ data: { weekKey, game: pool[randomInt(pool.length)], chosenBy: "RANDOM", createdAt: now } });
  });
}

/** The owner can explicitly repeat a game; automatic draws always exclude the preceding week. */
export async function overridePrizeGame(db: DbClient, game: unknown, now: Date) {
  const input = parseGameInput(prizeBodySchema, { game });
  const weekKey = weekKeyOf(now);
  if (input.game === "RUN" && weekKey < RUN_PRIZE_FROM_WEEK) {
    throw new AppError("VALIDATION", { message: copy.customer.run.prizeNotReady });
  }
  if (input.game === "M3" || input.game === "GRAB") {
    const tiers = await loadTierConfigs(db);
    if (!eligiblePrizeGames(weekKey, tiers.filter(t => t.id !== "big").length).includes(input.game)) {
      throw new AppError("VALIDATION", { message: input.game === "GRAB" ? copy.customer.grab.unavailable : copy.customer.m3.unavailable });
    }
  }
  return db.$transaction(async (tx) => {
    await lockPrizeWeeks(tx);
    const before = await tx.gamePrizeWeek.findUnique({ where: { weekKey } });
    if (before?.game === input.game && before.chosenBy === "OWNER") return before;
    const after = await tx.gamePrizeWeek.upsert({
      where: { weekKey },
      create: { weekKey, game: input.game, chosenBy: "OWNER", createdAt: now },
      update: { game: input.game, chosenBy: "OWNER" },
    });
    await writeAudit(tx, { actor: "ADMIN", action: "game.prize", entityType: "GamePrizeWeek", entityId: weekKey,
      before: before ? { game: before.game, chosenBy: before.chosenBy } : null,
      after: { game: after.game, chosenBy: after.chosenBy }, at: now });
    return after;
  });
}
