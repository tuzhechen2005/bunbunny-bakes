import { z } from "zod";
import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { gameOfRequest, setRunHidden } from "@/server/gameAdmin";

const body = z.object({ hidden: z.boolean() });

export const PATCH = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  // Run ids are unique over both games; ?game= (D124) is accepted and must match the run.
  const game = gameOfRequest(request);
  const { hidden } = body.parse(await request.json().catch(() => null));
  await setRunHidden(prisma, params.id, hidden, now, game);
  return Response.json({ ok: true });
});
