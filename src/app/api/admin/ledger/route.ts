// GET /api/admin/ledger?month=YYYY-MM (API_SPEC §3).

import { adminHandler, parseQuery } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { getLedgerMonth, monthQuerySchema } from "@/server/ledger";

export const GET = adminHandler(async ({ request }) =>
  Response.json(await getLedgerMonth(prisma, parseQuery(request, monthQuerySchema).month)),
);
