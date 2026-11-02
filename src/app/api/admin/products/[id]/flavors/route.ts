import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { createFlavor } from "@/server/productFlavors";

export const POST = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  const body: unknown = await request.json().catch(() => null);
  const product = await createFlavor(prisma, params.id, body, now);
  return Response.json({ product }, { status: 201 });
});
