import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const SITE = "https://bunbunnybakes.shop";
let previousSiteUrl: string | undefined;

beforeAll(() => {
  previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = SITE;
});
afterAll(() => {
  if (previousSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousSiteUrl;
});

function call(
  path: string,
  opts: { method?: string; cookie?: boolean; origin?: string | null } = {},
): Response {
  const method = opts.method ?? "GET";
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", "bb_session=abc123");
  const origin = opts.origin === undefined ? (method === "GET" ? null : SITE) : opts.origin;
  if (origin) headers.set("origin", origin);
  return proxy(new NextRequest(new URL(path, SITE), { method, headers }));
}

/** NextResponse.next() is marked with this header. */
function passes(res: Response): boolean {
  return res.headers.get("x-middleware-next") === "1";
}

describe("proxy: admin pages", () => {
  const protectedPages = ["/admin", "/admin/", "/admin/orders", "/admin/orders/123", "/admin/loginx", "/admin/login/extra", "/admin/resetx"];
  const publicPages = ["/admin/login", "/admin/reset", "/admin/login/"];

  it.each(protectedPages)("redirects %s to the login page without a cookie", (path) => {
    const res = call(path);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin/login");
  });

  it.each(protectedPages)("lets %s through with a cookie", (path) => {
    expect(passes(call(path, { cookie: true }))).toBe(true);
  });

  it.each(publicPages)("lets public page %s through without a cookie", (path) => {
    expect(passes(call(path))).toBe(true);
  });

  it("ignores an empty session cookie", () => {
    const headers = new Headers({ cookie: "bb_session=" });
    const res = proxy(new NextRequest(new URL("/admin/orders", SITE), { headers }));
    expect(res.status).toBe(307);
  });

  it("does not touch non-admin paths", () => {
    expect(passes(call("/"))).toBe(true);
    expect(passes(call("/administrator"))).toBe(true);
    expect(passes(call("/api/orders", { method: "POST", origin: null }))).toBe(true);
  });
});

describe("proxy: admin api", () => {
  const protectedApis = ["/api/admin/logout", "/api/admin/orders", "/api/admin/dashboard", "/api/admin/password-reset", "/api/admin/loginx"];
  const publicApis = ["/api/admin/login", "/api/admin/password-reset/request", "/api/admin/password-reset/confirm"];

  it.each(protectedApis)("answers 401 JSON for %s without a cookie", async (path) => {
    for (const method of ["GET", "POST"]) {
      const res = call(path, { method });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "UNAUTHORIZED", message: "请先登录" });
    }
  });

  it.each(protectedApis)("lets %s through with a cookie", (path) => {
    expect(passes(call(path, { cookie: true }))).toBe(true);
    expect(passes(call(path, { method: "POST", cookie: true }))).toBe(true);
  });

  it.each(publicApis)("lets public api %s through without a cookie", (path) => {
    expect(passes(call(path, { method: "POST" }))).toBe(true);
  });

  it.each([...publicApis, ...protectedApis])("rejects non-GET %s with a missing or foreign Origin", async (path) => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const origin of [null, "https://evil.example", "http://bunbunnybakes.shop"]) {
        const res = call(path, { method, origin, cookie: true });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "FORBIDDEN_ORIGIN" });
      }
    }
  });

  it("does not require Origin on GET", () => {
    expect(passes(call("/api/admin/orders", { cookie: true, origin: null }))).toBe(true);
  });
});
