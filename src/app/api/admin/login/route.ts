// POST /api/admin/login { username, password } (API_SPEC §3).

import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { login, MAX_PASSWORD_LENGTH } from "@/server/auth";
import { prisma } from "@/server/db";
import { checkOrigin } from "@/server/origin";
import { errorResponse, parseJsonBody, setSessionCookie } from "@/server/session";

const LoginBody = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

function clientIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

export async function POST(request: Request): Promise<Response> {
  const forbidden = checkOrigin(request);
  if (forbidden) return forbidden;
  try {
    const body = await parseJsonBody(request, LoginBody);
    await connection();
    const now = new Date();
    const result = await login(prisma, { ...body, ip: clientIp(request), now });
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, result.token);
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
