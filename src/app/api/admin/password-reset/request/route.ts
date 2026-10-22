// POST /api/admin/password-reset/request (no body). Always answers 200 with the same
// message, whether or not a link was created (rate limit, no admin, errors).

import { connection, NextResponse } from "next/server";
import { copy } from "@/copy";
import { requestPasswordReset } from "@/server/auth";
import { prisma } from "@/server/db";
import { checkOrigin } from "@/server/origin";

export async function POST(request: Request): Promise<Response> {
  const forbidden = checkOrigin(request);
  if (forbidden) return forbidden;
  try {
    await connection();
    const now = new Date();
    const siteUrl = process.env.SITE_URL;
    if (siteUrl) {
      await requestPasswordReset(prisma, { siteUrl, now });
    } else {
      console.error("password reset: SITE_URL is not set; no link created");
    }
  } catch (e) {
    // Never reveal what happened; the owner can retry.
    console.error("password reset request failed", e);
  }
  return NextResponse.json({ ok: true, message: copy.admin.auth.resetSent });
}
