import { z } from "zod";
import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { addTier, getTiers, initTiers } from "@/server/gameAdmin";

export const GET = adminHandler(async () => Response.json(await getTiers(prisma)));

const body = z.object({ productId: z.string().max(64).optional() });

export const POST = adminHandler(async ({ request, now }) => {
  const { productId } = body.parse(await request.json().catch(() => null));
  if (productId === undefined) await initTiers(prisma, now);
  else await addTier(prisma, productId, now);
  return Response.json(await getTiers(prisma), { status: 201 });
});
