// Session cookie helpers and the server-side admin guards (SECURITY.md §3).
// The proxy only checks that the cookie is present; every admin route handler and
// admin server component must call requireAdmin() / requireAdminPage(), which
// validate the session against the database.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { copy } from "@/copy";
import { getSession, SESSION_TTL_MS, type AdminSessionInfo } from "./auth";
import { prisma } from "./db";
import { AppError, isAppError } from "./errors";

export const SESSION_COOKIE = "bb_session";
export const LOGIN_PATH = "/admin/login";

export interface CookieEnv {
  siteUrl?: string;
  nodeEnv?: string;
}

function currentEnv(): CookieEnv {
  return { siteUrl: process.env.SITE_URL, nodeEnv: process.env.NODE_ENV };
}

/** Secure when the site is served over https or in production. */
export function cookieIsSecure(env: CookieEnv = currentEnv()): boolean {
  return env.nodeEnv === "production" || (env.siteUrl ?? "").toLowerCase().startsWith("https:");
}

export function sessionCookieOptions(env: CookieEnv = currentEnv()) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: cookieIsSecure(env),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export function setSessionCookie(response: NextResponse, token: string, env?: CookieEnv): void {
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(env));
}

export function clearSessionCookie(response: NextResponse, env?: CookieEnv): void {
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(env), maxAge: 0 });
}

/** Raw session token from a request's Cookie header, or null. */
export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface AdminContext {
  session: AdminSessionInfo;
  /** The request time, read once after connection(); pass it down. */
  now: Date;
}

async function currentSession(): Promise<AdminContext | null> {
  await connection();
  const now = new Date();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await getSession(prisma, token, now);
  return session ? { session, now } : null;
}

/**
 * For admin route handlers: the validated session, or throws AppError UNAUTHORIZED
 * (turn it into a response with errorResponse()).
 */
export async function requireAdmin(): Promise<AdminContext> {
  const ctx = await currentSession();
  if (!ctx) throw new AppError("UNAUTHORIZED");
  return ctx;
}

/** For admin server components: the validated session, or redirects to the login page. */
export async function requireAdminPage(): Promise<AdminContext> {
  const ctx = await currentSession();
  if (!ctx) redirect(LOGIN_PATH);
  return ctx;
}

/** API_SPEC §1 error JSON for any thrown value; unexpected errors never leak details. */
export function errorResponse(e: unknown): NextResponse {
  if (isAppError(e)) {
    return NextResponse.json(
      { error: e.code, message: e.message, ...(e.extra ?? {}) },
      { status: e.httpStatus },
    );
  }
  console.error("admin api: unexpected error", e);
  return NextResponse.json({ error: "INTERNAL", message: copy.errors.fallback }, { status: 500 });
}

/** Parses a JSON body with a Zod schema; throws AppError VALIDATION (with `fields`) otherwise. */
export async function parseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("VALIDATION", { extra: { fields: {} } });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= copy.errors.VALIDATION;
    }
    throw new AppError("VALIDATION", { extra: { fields } });
  }
  return parsed.data;
}
