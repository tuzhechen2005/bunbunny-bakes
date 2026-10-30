import { liveScoresEnabled } from "./liveScores";
import { GAME_CATALOG, type GameHub } from "@/lib/gameCatalog";
import type { DbClient } from "./db";
import { weekLeader } from "./game";
import { getPrizeWeek } from "./gamePrize";
import { weekRange } from "./gameWeek";

export async function getGameHub(db: DbClient, now: Date): Promise<GameHub> {
  const prize = await getPrizeWeek(db, now);
  const games = await Promise.all(GAME_CATALOG.map(async (game) => ({
    ...game, ...await weekLeader(db, prize.weekKey, game.kind, now),
  })));
  return { liveScores: liveScoresEnabled(), week: weekRange(prize.weekKey), prizeGame: prize.game, games };
}
