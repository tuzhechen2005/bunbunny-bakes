// GET /api/o/{token} (API_SPEC §2). The token is the only credential; never cached.

import { connection, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { jsonError, noStore } from "@/server/http";
import { getCustomerOrderView } from "@/server/orderView";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const { token } = await params;
    await connection();
    const view = await getCustomerOrderView(prisma, token, new Date());
    return noStore(NextResponse.json(view));
  } catch (e) {
    return noStore(jsonError(e));
  }
}
