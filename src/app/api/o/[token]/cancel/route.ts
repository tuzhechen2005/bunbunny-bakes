// POST /api/o/{token}/cancel (API_SPEC §2). Customer self-cancel before the cutoff.

import { connection, NextResponse } from "next/server";
import { copy } from "@/copy";
import { prisma } from "@/server/db";
import { AppError, isAppError } from "@/server/errors";
import { isWellFormedViewToken, jsonError, noStore, requireJsonContentType } from "@/server/http";
import { customerCancel } from "@/server/orderAdmin";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    requireJsonContentType(request);
    const { token } = await params;
    if (!isWellFormedViewToken(token)) throw new AppError("NOT_FOUND");
    await connection();
    const now = new Date();
    let result;
    try {
      result = await customerCancel(prisma, { viewToken: token }, now);
    } catch (e) {
      if (isAppError(e) && e.code === "CUTOFF_PASSED") {
        throw new AppError("CUTOFF_PASSED", { message: copy.errors.CUTOFF_PASSED_CANCEL });
      }
      throw e;
    }

    // notify: send notificationId (customer_cancelled) after commit (M6)
    void result.notificationId;

    return noStore(NextResponse.json({ status: "CANCELLED" }));
  } catch (e) {
    return noStore(jsonError(e));
  }
}
