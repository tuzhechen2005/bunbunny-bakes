// POST /api/admin/logout: deletes the current session and clears the cookie.

import { NextResponse } from "next/server";
import { logout } from "@/server/auth";
import { prisma } from "@/server/db";
import { checkOrigin } from "@/server/origin";
import { clearSessionCookie, errorResponse, readSessionToken } from "@/server/session";

export async function POST(request: Request): Promise<Response> {
  const forbidden = checkOrigin(request);
  if (forbidden) return forbidden;
  try {
    await logout(prisma, readSessionToken(request));
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
