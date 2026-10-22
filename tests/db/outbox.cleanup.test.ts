import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup } from "@/server/maintenance";
import { createDefaultProducts, createOpenDate, createOrder, db, resetDb } from "./helpers";

const NOW = new Date("2026-10-20T17:00:00Z");
const H = 3600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await db.$disconnect();
});

async function admin() {
  return db.adminUser.create({ data: { username: `u${crypto.randomUUID()}`, passwordHash: "x" } });
}

describe("cleanup", () => {
  it("deletes RateLimitHit older than 24 h only", async () => {
    await db.rateLimitHit.createMany({
      data: [
        { key: "old", at: ago(24 * H + 1) },
        { key: "edge", at: ago(24 * H) },
        { key: "new", at: ago(H) },
      ],
    });
    const res = await cleanup(db, NOW);
    expect(res.rateLimitHits).toBe(1);
    expect((await db.rateLimitHit.findMany()).map((r) => r.key).sort()).toEqual(["edge", "new"]);
  });

  it("deletes AdminSession with expiresAt <= now", async () => {
    const u = await admin();
    const base = { userId: u.id, lastSeenAt: ago(H) };
    await db.adminSession.createMany({
      data: [
        { ...base, tokenHash: "expired", expiresAt: ago(1) },
        { ...base, tokenHash: "edge", expiresAt: NOW },
        { ...base, tokenHash: "live", expiresAt: new Date(NOW.getTime() + 1) },
      ],
    });
    const res = await cleanup(db, NOW);
    expect(res.adminSessions).toBe(2);
    expect((await db.adminSession.findMany()).map((s) => s.tokenHash)).toEqual(["live"]);
  });

  it("deletes PasswordReset expired more than 24 h ago", async () => {
    const u = await admin();
    await db.passwordReset.createMany({
      data: [
        { userId: u.id, tokenHash: "old", expiresAt: ago(24 * H + 1) },
        { userId: u.id, tokenHash: "edge", expiresAt: ago(24 * H) },
        { userId: u.id, tokenHash: "recent", expiresAt: ago(H) },
        { userId: u.id, tokenHash: "live", expiresAt: new Date(NOW.getTime() + 15 * 60_000) },
      ],
    });
    const res = await cleanup(db, NOW);
    expect(res.passwordResets).toBe(1);
    expect((await db.passwordReset.findMany()).map((r) => r.tokenHash).sort()).toEqual(["edge", "live", "recent"]);
  });

  it("nulls Order.ipHash for orders created more than 24 h ago (exactly 24 h kept)", async () => {
    const ids = await createDefaultProducts();
    await createOpenDate("2026-10-22");
    const make = async (createdAt: Date) => {
      const o = await createOrder({ date: "2026-10-22", items: [{ productId: ids.redBean, qty: 1 }], createdAt });
      await db.order.update({ where: { id: o.id }, data: { ipHash: "hash" } });
      return db.order.findUniqueOrThrow({ where: { id: o.id } });
    };
    const old = await make(ago(24 * H + 1));
    const edge = await make(ago(24 * H));
    const fresh = await make(ago(H));

    const res = await cleanup(db, NOW);
    expect(res.ordersIpHashCleared).toBe(1);
    const after = async (id: string) => db.order.findUniqueOrThrow({ where: { id } });
    const oldAfter = await after(old.id);
    expect(oldAfter.ipHash).toBeNull();
    // The admin edit concurrency token is untouched.
    expect(oldAfter.updatedAt).toEqual(old.updatedAt);
    expect((await after(edge.id)).ipHash).toBe("hash");
    expect((await after(fresh.id)).ipHash).toBe("hash");

    // Idempotent.
    expect((await cleanup(db, NOW)).ordersIpHashCleared).toBe(0);
  });
});
