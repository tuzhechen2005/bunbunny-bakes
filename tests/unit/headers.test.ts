import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("next.config headers()", () => {
  it("sets no-referrer and noindex on order and admin pages, no-referrer on the order API", async () => {
    const rules = await nextConfig.headers!();
    const find = (source: string) => rules.find((r) => r.source === source)?.headers ?? [];
    const noReferrer = { key: "Referrer-Policy", value: "no-referrer" };
    const noIndex = { key: "X-Robots-Tag", value: "noindex" };
    expect(find("/o/:path*")).toEqual(expect.arrayContaining([noReferrer, noIndex]));
    expect(find("/admin/:path*")).toEqual(expect.arrayContaining([noReferrer, noIndex]));
    expect(find("/api/o/:path*")).toEqual([noReferrer]);
  });
});
