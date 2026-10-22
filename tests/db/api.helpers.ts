// Shared helpers for the customer API route tests (api.*.test.ts).
// Each test file must itself `vi.mock("next/server", …)` for connection() (vi.mock is per file).

export const SITE = "http://localhost:3111";
/** 2026-10-20 12:00 Chicago (CDT). Wed 10/21 is orderable until 10/20 20:00. */
export const NOW = new Date("2026-10-20T17:00:00Z");

export function jsonRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  method = "POST",
): Request {
  return new Request(SITE + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function getRequest(path: string, headers: Record<string, string> = {}): Request {
  return new Request(SITE + path, { method: "GET", headers });
}

export function tokenParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

/** A well-formed (43 char base64url) token that matches no order. */
export const UNKNOWN_TOKEN = "A".repeat(43);
