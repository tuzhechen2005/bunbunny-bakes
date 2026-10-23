import { describe, expect, it } from "vitest";
import { checkOrigin, isSameOrigin } from "@/server/origin";

function req(origin?: string, method = "POST"): Request {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  return new Request("https://bunbunnybakes.shop/api/admin/login", { method, headers });
}

const SITE = "https://bunbunnybakes.shop";

describe("isSameOrigin", () => {
  it("accepts the exact site origin", () => {
    expect(isSameOrigin(req("https://bunbunnybakes.shop"), SITE)).toBe(true);
    // SITE_URL may carry a path or trailing slash; only its origin counts.
    expect(isSameOrigin(req("https://bunbunnybakes.shop"), SITE + "/")).toBe(true);
    expect(isSameOrigin(req("http://localhost:3000"), "http://localhost:3000")).toBe(true);
  });

  it("rejects a missing Origin header", () => {
    expect(isSameOrigin(req(), SITE)).toBe(false);
  });

  it("rejects another origin", () => {
    expect(isSameOrigin(req("https://evil.example"), SITE)).toBe(false);
    expect(isSameOrigin(req("https://bunbunnybakes.shop.evil.example"), SITE)).toBe(false);
    expect(isSameOrigin(req("https://www.bunbunnybakes.shop"), SITE)).toBe(false);
    expect(isSameOrigin(req("null"), SITE)).toBe(false);
    expect(isSameOrigin(req("not a url"), SITE)).toBe(false);
  });

  it("rejects http vs https", () => {
    expect(isSameOrigin(req("http://bunbunnybakes.shop"), SITE)).toBe(false);
    expect(isSameOrigin(req("https://localhost:3000"), "http://localhost:3000")).toBe(false);
  });

  it("rejects a different port", () => {
    expect(isSameOrigin(req("http://localhost:3001"), "http://localhost:3000")).toBe(false);
    expect(isSameOrigin(req("https://bunbunnybakes.shop:8443"), SITE)).toBe(false);
    expect(isSameOrigin(req("http://localhost"), "http://localhost:3000")).toBe(false);
  });

  it("fails closed without a valid SITE_URL", () => {
    expect(isSameOrigin(req("https://bunbunnybakes.shop"), undefined)).toBe(false);
    expect(isSameOrigin(req("https://bunbunnybakes.shop"), "")).toBe(false);
    expect(isSameOrigin(req("https://bunbunnybakes.shop"), "garbage")).toBe(false);
  });
});

describe("checkOrigin", () => {
  it("lets GET through and blocks non-GET with a bad origin", async () => {
    expect(checkOrigin(req(undefined, "GET"), SITE)).toBeNull();
    expect(checkOrigin(req(SITE, "POST"), SITE)).toBeNull();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = checkOrigin(req("https://evil.example", method), SITE);
      expect(res?.status).toBe(403);
      expect(await res?.json()).toEqual({ error: "FORBIDDEN_ORIGIN" });
    }
    expect(checkOrigin(req(undefined, "POST"), SITE)?.status).toBe(403);
  });
});
