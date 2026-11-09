// GET /api/admin/ledger?month=YYYY-MM or ?from=YYYY-MM-DD&to=YYYY-MM-DD.

import { adminHandler, parseQuery } from "@/server/adminRoute";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { getLedgerMonth, getLedgerRange, monthQuerySchema, rangeQuerySchema } from "@/server/ledger";
import { errorResponse } from "@/server/session";

export const GET = adminHandler(async ({ request }) => {
  const params = new URL(request.url).searchParams;
  if (params.has("from") || params.has("to")) {
    let range;
    try {
      range = parseQuery(request, rangeQuerySchema);
    } catch (e) {
      // Range validation uses 400 (D190); legacy month validation stays 422.
      if (!(e instanceof AppError) || e.code !== "VALIDATION") throw e;
      const response = errorResponse(e);
      return new Response(response.body, { status: 400, headers: response.headers });
    }
    return Response.json(await getLedgerRange(prisma, range.from, range.to));
  }
  return Response.json(await getLedgerMonth(prisma, parseQuery(request, monthQuerySchema).month));
});
