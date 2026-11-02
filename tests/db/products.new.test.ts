import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()), connection: async () => {},
}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), revalidateTag: vi.fn() }));
const auditFailure = vi.hoisted(() => ({ on: false }));
vi.mock("@/server/audit", async (original) => {
  const actual = await original<typeof import("@/server/audit")>();
  return { ...actual, writeAudit: async (...args: Parameters<typeof actual.writeAudit>) => {
    if (auditFailure.on) throw new Error("audit failure");
    return actual.writeAudit(...args);
  } };
});
import { GET } from "@/app/api/menu/route";
import { prisma } from "@/server/db";
import * as menuModule from "@/server/menu";
import { getInitialMenu } from "@/server/menuCache";
import { publicProduct } from "@/server/assistant/tools";
import { createProduct, updateProduct } from "@/server/products";
import { createDefaultProducts, createSettings, db, resetDb } from "./helpers";

const now = new Date("2026-11-01T05:30:00.000Z");
const expiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
beforeEach(async () => {
  auditFailure.on = false;
  await resetDb();
  await createSettings();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { await db.$disconnect(); await prisma.$disconnect(); });

describe("new products with real Postgres", () => {
  it("expires after seven days in the API and on a cached read, without writes", async () => {
    const ids = await createDefaultProducts();
    await updateProduct(db, ids.brulee, { isNew: true }, now);
    await updateProduct(db, ids.rockCheese, { isNew: true }, now);
    const cached = await menuModule.getMenuData(db);
    // Simulate reuse of the exact cache payload across requests; Next's directive
    // is compiled only by Next, so Vitest replaces the underlying read here.
    const read = vi.spyOn(menuModule, "getMenuData").mockResolvedValue(cached);
    vi.stubEnv("HOME_INITIAL_MENU", "on");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(expiry.getTime() - 1));
    const activeOrder = [ids.rockCheese, ids.brulee, ids.redBean, ids.cheeseHorn];
    const body = await (await GET()).json();
    expect(body.products.map((p: { id: string }) => p.id)).toEqual(activeOrder);
    expect(body.products.map((p: { isNew: boolean }) => p.isNew)).toEqual([true, true, false, false]);
    expect(JSON.stringify(body)).not.toContain("newUntil");
    const initial = await getInitialMenu();
    expect(initial?.products.map(p => p.id)).toEqual(activeOrder);
    expect(JSON.stringify(initial)).not.toContain("newUntil");
    expect(publicProduct(initial!, initial!.products[0], "p1")).toMatchObject({ isNew: true });
    vi.setSystemTime(expiry);
    const expired = await (await GET()).json();
    const originalOrder = [ids.redBean, ids.rockCheese, ids.cheeseHorn, ids.brulee];
    expect(expired.products.map((p: { id: string }) => p.id)).toEqual(originalOrder);
    expect(expired.products.every((p: { isNew: boolean }) => !p.isNew)).toBe(true);
    const initialExpired = await getInitialMenu();
    expect(initialExpired?.products.map(p => p.id)).toEqual(originalOrder);
    expect(initialExpired?.products.every(p => !p.isNew)).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(await db.auditLog.count()).toBe(2);
    expect((await db.product.findUniqueOrThrow({ where: { id: ids.brulee } })).newUntil).toEqual(expiry);
    expect(cached.products.find(p => p.id === ids.brulee)?.newUntil).toEqual(expiry);
  });

  it("rolls back create and toggle if the audit fails", async () => {
    const ids = await createDefaultProducts();
    auditFailure.on = true;
    await expect(createProduct(db, {
      name: "New", unitPriceCents: 100, capacityMode: "INDEPENDENT", dailyLimit: 5, isNew: true,
    }, now)).rejects.toThrow("audit failure");
    expect(await db.product.count()).toBe(4);
    await expect(updateProduct(db, ids.brulee, { isNew: true }, now)).rejects.toThrow("audit failure");
    expect((await db.product.findUniqueOrThrow({ where: { id: ids.brulee } })).newUntil).toBeNull();
    expect(await db.auditLog.count()).toBe(0);
  });
});
