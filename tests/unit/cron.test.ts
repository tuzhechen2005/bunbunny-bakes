import { describe, expect, it } from "vitest";
import { isCronAuthorized, requireCron } from "@/server/cron";

const req = (auth?: string) =>
  new Request("http://localhost/api/cron/outbox", { method: "POST", headers: auth ? { authorization: auth } : {} });

describe("cron auth", () => {
  it("accepts the exact bearer secret", () => {
    expect(isCronAuthorized(req("Bearer s3cret-value"), "s3cret-value")).toBe(true);
    expect(requireCron(req("Bearer s3cret-value"), "s3cret-value")).toBeNull();
  });

  it("rejects missing, malformed, wrong and prefix secrets", () => {
    for (const h of [undefined, "", "s3cret-value", "Basic s3cret-value", "Bearer ", "Bearer s3cret", "Bearer s3cret-value2", "bearer s3cret-value"]) {
      expect(isCronAuthorized(req(h), "s3cret-value")).toBe(false);
    }
  });

  it("fails closed when the secret is not configured", () => {
    expect(isCronAuthorized(req("Bearer "), "")).toBe(false);
    expect(isCronAuthorized(req("Bearer undefined"), undefined)).toBe(false);
  });

  it("returns a 401 JSON response when unauthorized", async () => {
    const res = requireCron(req("Bearer nope"), "s3cret-value");
    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "UNAUTHORIZED", message: "unauthorized" });
  });
});
