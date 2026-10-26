import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { banBodySchema, banWechat } from "@/server/gameAdmin";

export const POST = adminHandler(async ({ request, now }) => {
  const input = banBodySchema.parse(await request.json().catch(() => null));
  await banWechat(prisma, input, now);
  return Response.json({ ok: true }, { status: 201 });
});
