import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { getPrizeWeek, overridePrizeGame, prizeBodySchema } from "@/server/gamePrize";
import { noStore } from "@/server/http";

export const GET = adminHandler(async ({ now }) => noStore(Response.json(await getPrizeWeek(prisma, now))));

export const PATCH = adminHandler(async ({ request, now }) => {
  const { game } = prizeBodySchema.parse(await request.json().catch(() => null));
  return noStore(Response.json(await overridePrizeGame(prisma, game, now)));
});
