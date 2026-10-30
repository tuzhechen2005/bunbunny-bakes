import { randomInt } from "node:crypto";
import { z } from "zod";
import { addDays } from "@/domain/dates";
import type { LocalDate } from "@/domain/types";
import { GAME_CATALOG } from "@/lib/gameCatalog";
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
  return db.$transaction(async (tx) => {
    await lockPrizeWeeks(tx);
    const prior = await tx.gamePrizeWeek.findUnique({ where: { weekKey } });
    if (prior) return prior;
    const last = await tx.gamePrizeWeek.findUnique({ where: { weekKey: previousWeekKey(weekKey) } });
    // A deployment may first see the new week, then the cron for the closed week.
    const next = await tx.gamePrizeWeek.findUnique({ where: { weekKey: addDays(weekKey, 7) } });
    const candidates = enabledKinds.filter((game) => game !== last?.game && game !== next?.game);
    // An owner may have chosen incompatible neighbours. Honour the preceding week's exclusion.
    const pool = candidates.length ? candidates : enabledKinds.filter((game) => game !== last?.game);
    if (!pool.length) throw new Error("At least two enabled games are required for weekly prizes");
    return tx.gamePrizeWeek.create({ data: { weekKey, game: pool[randomInt(pool.length)], chosenBy: "RANDOM", createdAt: now } });
  });
}

/** The owner can explicitly repeat a game; automatic draws always exclude the preceding week. */
export async function overridePrizeGame(db: DbClient, game: unknown, now: Date) {
  const input = parseGameInput(prizeBodySchema, { game });
  const weekKey = weekKeyOf(now);
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
