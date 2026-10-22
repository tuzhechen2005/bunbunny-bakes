import { describe, expect, it } from "vitest";
import { checkOrigin, isSameOrigin } from "@/server/origin";

function req(origin?: string, method = "POST"): Request {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  return new Request("https://bunbunnybakes.com/api/admin/login", { method, headers });
}

const SITE = "https://bunbunnybakes.com";

describe("isSameOrigin", () => {
  it("accepts the exact site origin", () => {
    expect(isSameOrigin(req("https://bunbunnybakes.com"), SITE)).toBe(true);
    // SITE_URL may carry a path or trailing slash; only its origin counts.
    expect(isSameOrigin(req("https://bunbunnybakes.com"), SITE + "/")).toBe(true);
    expect(isSameOrigin(req("http://localhost:3000"), "http://localhost:3000")).toBe(true);
  });

  it("rejects a missing Origin header", () => {
    expect(isSameOrigin(req(), SITE)).toBe(false);
  });

  it("rejects another origin", () => {
    expect(isSameOrigin(req("https://evil.example"), SITE)).toBe(false);
    expect(isSameOrigin(req("https://bunbunnybakes.com.evil.example"), SITE)).toBe(false);
    expect(isSameOrigin(req("https://www.bunbunnybakes.com"), SITE)).toBe(false);
    expect(isSameOrigin(req("null"), SITE)).toBe(false);
    expect(isSameOrigin(req("not a url"), SITE)).toBe(false);
  });

  it("rejects http vs https", () => {
    expect(isSameOrigin(req("http://bunbunnybakes.com"), SITE)).toBe(false);
    expect(isSameOrigin(req("https://localhost:3000"), "http://localhost:3000")).toBe(false);
  });

  it("rejects a different port", () => {
    expect(isSameOrigin(req("http://localhost:3001"), "http://localhost:3000")).toBe(false);
    expect(isSameOrigin(req("https://bunbunnybakes.com:8443"), SITE)).toBe(false);
    expect(isSameOrigin(req("http://localhost"), "http://localhost:3000")).toBe(false);
  });

  it("fails closed without a valid SITE_URL", () => {
    expect(isSameOrigin(req("https://bunbunnybakes.com"), undefined)).toBe(false);
    expect(isSameOrigin(req("https://bunbunnybakes.com"), "")).toBe(false);
    expect(isSameOrigin(req("https://bunbunnybakes.com"), "garbage")).toBe(false);
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
