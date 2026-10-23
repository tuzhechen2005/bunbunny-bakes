// POST /api/admin/ledger/manual (API_SPEC §3).

import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { createManualIncome, parseManualBody } from "@/server/ledger";
import { readJsonObject } from "@/server/orderRouteBody";

export const POST = adminHandler(async ({ request, now }) => {
  const entry = await createManualIncome(prisma, parseManualBody(await readJsonObject(request)), now);
  return Response.json({ entry }, { status: 201 });
});
