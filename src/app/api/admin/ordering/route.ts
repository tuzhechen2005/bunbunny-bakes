// POST /api/admin/ordering { enabled } (API_SPEC §3).

import { z } from "zod";
import { adminHandler } from "@/server/adminRoute";
import { setOrderingEnabled } from "@/server/dashboard";
import { prisma } from "@/server/db";
import { parseJsonBody } from "@/server/session";

const Body = z.object({ enabled: z.boolean() });

export const POST = adminHandler(async ({ request, now }) => {
  const { enabled } = await parseJsonBody(request, Body);
  return Response.json(await setOrderingEnabled(prisma, enabled, now));
});
