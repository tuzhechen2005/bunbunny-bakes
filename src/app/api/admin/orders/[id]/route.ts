// GET   /api/admin/orders/{id}  full order + view link + next statuses + audit log
// PATCH /api/admin/orders/{id}  edit (items, date, fulfillment, WeChat id, note)

import { adminHandler } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { adminEditOrder, type AdminEditOrderInput } from "@/server/orderAdmin";
import { getOrderDetail } from "@/server/orderQueries";
import { readJsonObject } from "@/server/orderRouteBody";

type Params = { id: string };

export const GET = adminHandler<Params>(async ({ params }) => {
  return Response.json(await getOrderDetail(prisma, params.id));
});

export const PATCH = adminHandler<Params>(async ({ request, params, now }) => {
  const body = await readJsonObject(request);
  const summary = await adminEditOrder(
    prisma,
    { ...body, orderId: params.id } as unknown as AdminEditOrderInput,
    now,
  );
  return Response.json(summary);
});
