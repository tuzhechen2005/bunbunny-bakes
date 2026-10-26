import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { awardBodySchema, updateAward } from "@/server/gameAdmin";

export const PATCH = adminHandler(async ({ request, now }) => {
  const input = awardBodySchema.parse(await request.json().catch(() => null));
  await updateAward(prisma, input, now);
  return Response.json({ ok: true });
});
