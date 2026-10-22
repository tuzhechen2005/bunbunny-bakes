// Auth for /api/cron/* (docs/SECURITY.md §5): `Authorization: Bearer <CRON_SECRET>`,
// compared in constant time. Fails closed when CRON_SECRET is unset.
import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isCronAuthorized(request: Request, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  // Hash both sides so the comparison is constant-time regardless of length.
  return timingSafeEqual(digest(match[1]), digest(secret));
}

/** Returns a 401 response when the request is not from the scheduler, else null. */
export function requireCron(request: Request, secret?: string): Response | null {
  if (isCronAuthorized(request, secret)) return null;
  return Response.json({ error: "UNAUTHORIZED", message: "unauthorized" }, { status: 401 });
}
