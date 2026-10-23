// PATCH / DELETE /api/admin/ledger/manual/{id} (API_SPEC §3).

import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { deleteManualIncome, parseManualBody, updateManualIncome } from "@/server/ledger";
import { readJsonObject } from "@/server/orderRouteBody";

export const PATCH = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  const entry = await updateManualIncome(
    prisma,
    params.id,
    parseManualBody(await readJsonObject(request)),
    now,
  );
  return Response.json({ entry });
});

export const DELETE = adminHandler<{ id: string }>(async ({ params, now }) => {
  await deleteManualIncome(prisma, params.id, now);
  return Response.json({ ok: true });
});
