// GET /api/admin/ledger/day?date=YYYY-MM-DD (API_SPEC §3).

import { adminHandler, parseQuery } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { dayQuerySchema, getLedgerDay } from "@/server/ledger";

export const GET = adminHandler(async ({ request }) =>
  Response.json(await getLedgerDay(prisma, parseQuery(request, dayQuerySchema).date)),
);
