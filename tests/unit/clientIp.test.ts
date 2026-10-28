import { describe, expect, it, vi } from "vitest";
import { clientIp } from "@/server/http";

const req = (headers: Record<string, string>) => new Request("http://x/", { headers });

describe("clientIp", () => {
  it("prefers Netlify's connection IP over a client-supplied x-forwarded-for", () => {
    expect(
      clientIp(req({ "x-nf-client-connection-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4, 10.0.0.1" })),
    ).toBe("203.0.113.9");
  });

  it("falls back to x-forwarded-for (first hop), then x-real-ip, then 'unknown'", () => {
    expect(clientIp(req({ "x-forwarded-for": " 1.2.3.4 , 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(req({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(clientIp(req({}))).toBe("unknown");
    expect(clientIp(req({ "x-nf-client-connection-ip": "  " }))).toBe("unknown");
    warn.mockRestore();
  });
});
