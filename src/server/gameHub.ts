import { GAME_CATALOG, type GameHub } from "@/lib/gameCatalog";
import type { DbClient } from "./db";
import { weekBest } from "./game";
import { getPrizeWeek } from "./gamePrize";
import { weekRange } from "./gameWeek";

export async function getGameHub(db: DbClient, now: Date): Promise<GameHub> {
  const prize = await getPrizeWeek(db, now);
  const games = await Promise.all(GAME_CATALOG.map(async (game) => ({
    ...game, weekBest: await weekBest(db, prize.weekKey, game.kind),
  })));
  return { week: weekRange(prize.weekKey), prizeGame: prize.game, games };
}
