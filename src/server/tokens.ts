// Random tokens and hashes (SECURITY.md §2, §4; D31, D38).

import { createHash, randomBytes } from "node:crypto";

/** Order view token: 32 random bytes, base64url (43 characters). */
export function newViewToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256 hex of ip + secret. Only this hash is ever stored. */
export function hashIp(ip: string, secret: string): string {
  if (!secret) throw new Error("hashIp: secret is empty (set IP_HASH_SECRET)");
  return createHash("sha256").update(ip + secret).digest("hex");
}
