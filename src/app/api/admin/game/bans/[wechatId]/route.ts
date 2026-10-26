import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { unbanWechat } from "@/server/gameAdmin";

export const DELETE = adminHandler<{ wechatId: string }>(async ({ params, now }) => {
  await unbanWechat(prisma, params.wechatId, now);
  return Response.json({ ok: true });
});
