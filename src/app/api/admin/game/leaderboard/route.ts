import { z } from "zod";
import { adminHandler, parseQuery } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { gameQuerySchema, getBoard, weekQuerySchema } from "@/server/gameAdmin";

// ?game=tu = 兔了个兔 (D124); absent or big = 消除大面包.
const query = z.object({ week: weekQuerySchema.optional(), game: gameQuerySchema });

export const GET = adminHandler(async ({ request, now }) => {
  const { week, game } = parseQuery(request, query);
  return Response.json(await getBoard(prisma, week, now, game));
});
