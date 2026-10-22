// Fast-path guard for the admin area (SECURITY.md §3). It only checks that the
// session cookie is present (no database here); every admin route handler and server
// component still validates the session with requireAdmin() / requireAdminPage().
// It also runs the Origin check for non-GET /api/admin/** requests.

import { NextResponse, type NextRequest } from "next/server";
import { copy } from "@/copy";
import { forbiddenOriginResponse, isSafeMethod, isSameOrigin } from "@/server/origin";

const SESSION_COOKIE = "bb_session"; // = SESSION_COOKIE in src/server/session.ts
const LOGIN_PATH = "/admin/login";

const PUBLIC_PAGES = new Set(["/admin/login", "/admin/reset"]);
const PUBLIC_APIS = new Set([
  "/api/admin/login",
  "/api/admin/password-reset/request",
  "/api/admin/password-reset/confirm",
]);

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

export function proxy(request: NextRequest): Response {
  const path = stripTrailingSlash(request.nextUrl.pathname);
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (isUnder(path, "/api/admin")) {
    if (!isSafeMethod(request.method) && !isSameOrigin(request, process.env.SITE_URL)) {
      return forbiddenOriginResponse();
    }
    if (!PUBLIC_APIS.has(path) && !hasSession) {
      return NextResponse.json({ error: "UNAUTHORIZED", message: copy.errors.UNAUTHORIZED }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (isUnder(path, "/admin")) {
    if (!PUBLIC_PAGES.has(path) && !hasSession) {
      return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin", "/api/admin/:path*"],
};
