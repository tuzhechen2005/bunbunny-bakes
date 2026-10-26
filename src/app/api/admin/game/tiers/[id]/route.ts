import { z } from "zod";
import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { getImageStore } from "@/server/imageStore";
import { getTiers, removeTier, updateTierLook, updateTierProduct } from "@/server/gameAdmin";

const body = z.object({ productId: z.string().max(64) });

/** `{ productId }` re-points the tier at another product; `{ name?, fieldColor? }` edits its look (D107). */
export const PATCH = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  const raw = await request.json().catch(() => null);
  if (raw && typeof raw === "object" && "productId" in raw) {
    const { productId } = body.parse(raw);
    await updateTierProduct(prisma, params.id, productId, now);
  } else {
    await updateTierLook(prisma, params.id, raw, now);
  }
  return Response.json(await getTiers(prisma));
});

export const DELETE = adminHandler<{ id: string }>(async ({ params, now }) => {
  await removeTier(prisma, getImageStore(), params.id, now);
  return Response.json(await getTiers(prisma));
});
