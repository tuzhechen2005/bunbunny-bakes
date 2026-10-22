// Small HTTP helpers shared by the public customer route handlers.

import type { NextResponse } from "next/server";
import { AppError } from "./errors";
import { errorResponse } from "./session";

/**
 * Client IP for rate limiting (D57): first x-forwarded-for entry, else x-real-ip, else the
 * literal "unknown" (a shared bucket, so the per-IP limit always applies). Warns on fallback.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  console.warn("clientIp: no x-forwarded-for or x-real-ip header; using the shared 'unknown' bucket");
  return "unknown";
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
