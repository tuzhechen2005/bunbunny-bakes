// CSRF guard (SECURITY.md §3): non-GET /api/admin/** requests must carry an Origin
// header equal to the origin of SITE_URL. Pure (no db, no Node-only APIs), so the
// proxy can use it too.

/** True iff the request's Origin header is exactly the origin of `siteUrl`. Fails closed. */
export function isSameOrigin(request: Request, siteUrl: string | undefined | null): boolean {
  const header = request.headers.get("origin");
  if (!header || header === "null" || !siteUrl) return false;
  try {
    const expected = new URL(siteUrl).origin;
    if (expected === "null") return false;
    // Browsers send the serialized origin ("scheme://host[:port]"), so compare exactly.
    return header === expected;
  } catch {
    return false;
  }
}

/** Methods that are exempt from the Origin check. */
export function isSafeMethod(method: string): boolean {
  return method.toUpperCase() === "GET";
}

/** The 403 response for a failed Origin check. */
export function forbiddenOriginResponse(): Response {
  return Response.json({ error: "FORBIDDEN_ORIGIN" }, { status: 403 });
}

/**
 * For route handlers: null when the request may proceed, otherwise the 403 response.
 * GET requests always pass; everything else needs a same-origin Origin header.
 */
export function checkOrigin(
  request: Request,
  siteUrl: string | undefined | null = process.env.SITE_URL,
): Response | null {
  if (isSafeMethod(request.method)) return null;
  return isSameOrigin(request, siteUrl) ? null : forbiddenOriginResponse();
}
