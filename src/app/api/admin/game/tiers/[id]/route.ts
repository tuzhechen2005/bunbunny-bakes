import { z } from "zod";
import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { getImageStore } from "@/server/imageStore";
import { getTiers, removeTier, updateTierProduct } from "@/server/gameAdmin";

const body = z.object({ productId: z.string().max(64) });

export const PATCH = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  const { productId } = body.parse(await request.json().catch(() => null));
  await updateTierProduct(prisma, params.id, productId, now);
  return Response.json(await getTiers(prisma));
});

export const DELETE = adminHandler<{ id: string }>(async ({ params, now }) => {
  await removeTier(prisma, getImageStore(), params.id, now);
  return Response.json(await getTiers(prisma));
});
