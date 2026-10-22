// POST /api/admin/orders/{id}/correct-status  { to, reason, override?, expectedUpdatedAt }

import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { adminCorrectStatus, type AdminCorrectStatusInput } from "@/server/orderAdmin";
import { readJsonObject } from "@/server/orderRouteBody";

export const POST = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  const body = await readJsonObject(request);
  const summary = await adminCorrectStatus(
    prisma,
    { ...body, orderId: params.id } as unknown as AdminCorrectStatusInput,
    now,
  );
  return Response.json(summary);
});
