// POST /api/admin/orders/{id}/status  { to, reason?, expectedUpdatedAt }

import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { adminChangeStatus, type AdminChangeStatusInput } from "@/server/orderAdmin";
import { readJsonObject } from "@/server/orderRouteBody";

export const POST = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  const body = await readJsonObject(request);
  const summary = await adminChangeStatus(
    prisma,
    { ...body, orderId: params.id } as unknown as AdminChangeStatusInput,
    now,
  );
  return Response.json(summary);
});
