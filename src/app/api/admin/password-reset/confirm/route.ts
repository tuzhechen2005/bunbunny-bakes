// POST /api/admin/password-reset/confirm { token, newPassword } (API_SPEC §3).

import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { confirmPasswordReset, MAX_PASSWORD_LENGTH } from "@/server/auth";
import { prisma } from "@/server/db";
import { checkOrigin } from "@/server/origin";
import { clearSessionCookie, errorResponse, parseJsonBody } from "@/server/session";

const ConfirmBody = z.object({
  token: z.string().min(1).max(128),
  // The >= 10 rule is enforced by confirmPasswordReset with a specific message.
  newPassword: z.string().max(MAX_PASSWORD_LENGTH),
});

export async function POST(request: Request): Promise<Response> {
  const forbidden = checkOrigin(request);
  if (forbidden) return forbidden;
  try {
    const body = await parseJsonBody(request, ConfirmBody);
    await connection();
    const now = new Date();
    await confirmPasswordReset(prisma, { ...body, now });
    const response = NextResponse.json({ ok: true });
    // Every session is gone; drop the stale cookie on this device too.
    clearSessionCookie(response);
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
