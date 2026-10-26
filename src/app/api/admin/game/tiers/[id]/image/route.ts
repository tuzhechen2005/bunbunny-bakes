import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { deleteTierImage, getTiers, uploadTierImage } from "@/server/gameAdmin";
import { getImageStore } from "@/server/imageStore";

export const POST = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  await uploadTierImage(prisma, getImageStore(), params.id, request, now);
  return Response.json(await getTiers(prisma));
});

export const DELETE = adminHandler<{ id: string }>(async ({ params, now }) => {
  await deleteTierImage(prisma, getImageStore(), params.id, now);
  return Response.json(await getTiers(prisma));
});
