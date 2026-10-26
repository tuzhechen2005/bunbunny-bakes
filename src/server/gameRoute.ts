// Shared plumbing for the public /api/game/* handlers (kept out of the route files so they stay thin).

import { AppError } from "./errors";
import { clientIp, requireJsonContentType } from "./http";
import { hashIp } from "./tokens";

/** IP hash for rate limiting; null when IP_HASH_SECRET is missing (the route answers 500). */
export function gameIpHash(request: Request): string | null {
  const secret = process.env.IP_HASH_SECRET;
  if (!secret) {
    console.error("/api/game: IP_HASH_SECRET is not set; refusing");
    return null;
  }
  return hashIp(clientIp(request), secret);
}

/** Reads a small JSON object body: JSON content type, bounded size, object shape. */
export async function readGameJson(request: Request, maxBytes: number): Promise<unknown> {
  requireJsonContentType(request);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new AppError("VALIDATION", { extra: { fields: {} } });
  const text = await request.text();
  if (text.length > maxBytes) throw new AppError("VALIDATION", { extra: { fields: {} } });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION", { extra: { fields: {} } });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("VALIDATION", { extra: { fields: {} } });
  }
  return body;
}
