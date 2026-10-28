import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { awardBodySchema, gameOfRequest, updateAward } from "@/server/gameAdmin";

export const PATCH = adminHandler(async ({ request, now }) => {
  // ?game=tu = 兔了个兔 (D124); absent or big = 消除大面包.
  const game = gameOfRequest(request);
  const input = awardBodySchema.parse(await request.json().catch(() => null));
  await updateAward(prisma, input, now, game);
  return Response.json({ ok: true });
});
