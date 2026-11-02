// GET  /api/admin/orders  list with filters; date=all opts into descending history (D137)
// POST /api/admin/orders  phone order entered by the owner; starts CONFIRMED

import { adminHandler, parseQuery } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { createAdminOrder, type AdminCreateInput } from "@/server/orders";
import { listOrders, listOrdersQuerySchema, viewUrlOf } from "@/server/orderQueries";
import { readJsonObject } from "@/server/orderRouteBody";

export const GET = adminHandler(async ({ request, now }) => {
  const query = parseQuery(request, listOrdersQuerySchema);
  return Response.json(await listOrders(prisma, query, now));
});

export const POST = adminHandler(async ({ request, now }) => {
  const body = await readJsonObject(request);
  const created = await createAdminOrder(prisma, body as unknown as AdminCreateInput, now);
  return Response.json(
    { id: created.id, orderNo: created.orderNo, viewUrl: viewUrlOf(created.viewToken) },
    { status: 201 },
  );
});
