// POST /api/admin/orders/{id}/payment  { paid, method?, expectedUpdatedAt }

import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { adminSetPayment, type AdminSetPaymentInput } from "@/server/orderAdmin";
import { readJsonObject } from "@/server/orderRouteBody";

export const POST = adminHandler<{ id: string }>(async ({ request, params, now }) => {
  const body = await readJsonObject(request);
  const summary = await adminSetPayment(
    prisma,
    { ...body, orderId: params.id } as unknown as AdminSetPaymentInput,
    now,
  );
  return Response.json(summary);
});
