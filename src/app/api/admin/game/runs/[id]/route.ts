import { z } from "zod";
import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { setRunHidden } from "@/server/gameAdmin";

const body = z.object({ hidden: z.boolean() });

export const PATCH = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  const { hidden } = body.parse(await request.json().catch(() => null));
  await setRunHidden(prisma, params.id, hidden, now);
  return Response.json({ ok: true });
});
