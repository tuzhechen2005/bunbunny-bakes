import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { updateFlavor } from "@/server/productFlavors";

export const PATCH = adminHandler<{ id: string; flavorId: string }>(async ({ request, params, now }) => {
  const body: unknown = await request.json().catch(() => null);
  const product = await updateFlavor(prisma, params.id, params.flavorId, body, now);
  return Response.json({ product });
});
