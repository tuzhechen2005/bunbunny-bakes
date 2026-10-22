// GET /api/admin/logs?q=&entityId=&from=&to=&cursor= (API_SPEC §3).

import { adminHandler, parseQuery } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { listLogs, logsQuerySchema } from "@/server/logs";

export const GET = adminHandler(async ({ request }) =>
  Response.json(await listLogs(prisma, parseQuery(request, logsQuerySchema))),
);
