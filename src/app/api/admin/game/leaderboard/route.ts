import { z } from "zod";
import { adminHandler, parseQuery } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { getBoard, weekQuerySchema } from "@/server/gameAdmin";

const query = z.object({ week: weekQuerySchema.optional() });

export const GET = adminHandler(async ({ request, now }) => {
  const { week } = parseQuery(request, query);
  return Response.json(await getBoard(prisma, week, now));
});
