// POST /api/o/{token}/cancel (API_SPEC §2). Customer self-cancel before the cutoff.

import { connection, NextResponse } from "next/server";
import { copy } from "@/copy";
import { prisma } from "@/server/db";
import { AppError, isAppError } from "@/server/errors";
import { isWellFormedViewToken, jsonError, noStore, requireJsonContentType } from "@/server/http";
import { customerCancel } from "@/server/orderAdmin";
import { sendAfterResponse } from "@/server/outboxSend";

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

    // Committed: send the cancellation email after the response (null if already cancelled).
    sendAfterResponse(prisma, result.notificationId, now);

    return noStore(NextResponse.json({ status: "CANCELLED" }));
  } catch (e) {
    return noStore(jsonError(e));
  }
}
