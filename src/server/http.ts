// Small HTTP helpers shared by the public customer route handlers.

import type { NextResponse } from "next/server";
import { AppError } from "./errors";
import { errorResponse } from "./session";

/** First x-forwarded-for entry, trimmed (Vercel puts the client first), or null. */
export function clientIp(request: Request): string | null {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || null;
}

/** API_SPEC §1 JSON for any thrown value; unexpected errors become a generic 500. */
export function jsonError(e: unknown): NextResponse {
  return errorResponse(e);
}

/**
 * Customer POSTs must be application/json: a plain HTML form cannot send that without
 * a CORS preflight, which blocks simple-form CSRF. Throws VALIDATION otherwise.
 */
export function requireJsonContentType(request: Request): void {
  const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") {
    throw new AppError("VALIDATION", { extra: { fields: {} } });
  }
}

/** Marks a response as uncacheable (order pages carry private data behind a secret URL). */
export function noStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Order view tokens are 32 random bytes in base64url: exactly 43 characters. */
const VIEW_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedViewToken(token: unknown): token is string {
  return typeof token === "string" && VIEW_TOKEN_RE.test(token);
}
