import { z } from "zod";
import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { getTiers, reorderTiers } from "@/server/gameAdmin";

const body = z.object({ ids: z.array(z.string().max(64)).max(16) });

export const PUT = adminHandler(async ({ request, now }) => {
  const { ids } = body.parse(await request.json().catch(() => null));
  await reorderTiers(prisma, ids, now);
  return Response.json(await getTiers(prisma));
});
