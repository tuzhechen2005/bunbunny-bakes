import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
import { POST } from "@/app/api/orders/route";
import { prisma } from "@/server/db";
import { hashIp } from "@/server/tokens";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";
import { jsonRequest, NOW } from "./api.helpers";

const SECRET = "test-secret";
let ids: DefaultProductIds;
let prevSecret: string | undefined;

beforeAll(() => {
  prevSecret = process.env.IP_HASH_SECRET;
  process.env.IP_HASH_SECRET = SECRET;
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await resetDb();
  await createSettings({ orderingEnabled: true });
  ids = await createDefaultProducts();
  await createOpenDate("2026-10-22");
  await createOpenDate("2026-10-23");
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  if (prevSecret === undefined) delete process.env.IP_HASH_SECRET;
  else process.env.IP_HASH_SECRET = prevSecret;
  await db.$disconnect();
  await prisma.$disconnect();
});

let n = 0;
function body(over: Record<string, unknown> = {}) {
  n += 1;
  return {
    items: [{ productId: ids.redBean, qty: 2 }],
    pickupDate: "2026-10-22",
    fulfillment: "PICKUP",
    wechatId: `wx_${n}`,
    note: "",
    idempotencyKey: crypto.randomUUID(),
    website: "",
    ...over,
  };
}
const post = (b: unknown, headers: Record<string, string> = { "x-forwarded-for": "203.0.113.7" }) =>
  POST(jsonRequest("/api/orders", b, headers));

describe("POST /api/orders", () => {
  it("201 happy path with URL shape and 43-char token", async () => {
    const res = await post(body());
    expect(res.status).toBe(201);
    const j = await res.json();
    expect(Object.keys(j).sort()).toEqual(["orderNo", "url", "viewToken"]);
    expect(j.viewToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(j.url).toBe(`/o/${j.viewToken}`);
    expect(j.orderNo).toBe("1022-001");
  });

  it("ignores client-sent amounts", async () => {
    const res = await post(body({ totalCents: 1, subtotalCents: 1, deliveryFeeCents: 0, lineTotalCents: 1 }));
    expect(res.status).toBe(201);
    const o = await db.order.findFirstOrThrow({ include: { items: true } });
    expect(o.totalCents).toBe(498);
    expect(o.subtotalCents).toBe(498);
    expect(o.items[0].lineTotalCents).toBe(498);
  });

  it("honeypot -> 422 generic message and nothing written", async () => {
    const res = await post(body({ website: "http://spam.example" }));
    expect(res.status).toBe(422);
    const j = await res.json();
    expect(j.error).toBe("VALIDATION");
    expect(j.message).toBe("提交失败，请稍后再试");
    expect(await db.order.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("replay with the same idempotencyKey -> 200 same token", async () => {
    const b = body();
    const first = await (await post(b)).json();
    const res = await post(b);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(first);
    expect(await db.order.count()).toBe(1);
  });

  it("FULL -> 409 with top-level suggestion", async () => {
    await createOpenDate("2026-10-24", {});
    await db.openDate.update({ where: { date: new Date("2026-10-22T00:00:00Z") }, data: { doughLimitG: 70 } });
    await createOrder({ date: "2026-10-22", items: [{ productId: ids.redBean, qty: 1 }] });
    const res = await post(body());
    expect(res.status).toBe(409);
    const j = await res.json();
    expect(j.error).toBe("FULL");
    expect(j.suggestion).toBe("2026-10-23");
  });

  it("ordering disabled -> 409", async () => {
    await createSettings({ orderingEnabled: false });
    const res = await post(body());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ORDERING_DISABLED");
  });

  it("rate limited -> 429 after 5 orders from one IP (D86)", async () => {
    for (let i = 0; i < 5; i++) expect((await post(body())).status).toBe(201);
    const res = await post(body());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("RATE_LIMITED");
  });

  it("takes the IP from the first x-forwarded-for entry and stores only its hash", async () => {
    const res = await post(body(), { "x-forwarded-for": " 198.51.100.9 , 10.0.0.1" });
    expect(res.status).toBe(201);
    const o = await db.order.findFirstOrThrow();
    expect(o.ipHash).toBe(hashIp("198.51.100.9", SECRET));
    const str = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
    const dump = str(o) + str(await db.rateLimitHit.findMany()) + str(await db.auditLog.findMany());
    expect(dump).not.toContain("198.51.100.9");
    expect(dump).not.toContain("10.0.0.1");
  });

  it("D57: falls back to x-real-ip, then a shared 'unknown' bucket; the limit always applies", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect((await post(body(), { "x-forwarded-for": "  ", "x-real-ip": "192.0.2.5" })).status).toBe(201);
      expect((await db.order.findFirstOrThrow()).ipHash).toBe(hashIp("192.0.2.5", SECRET));
      expect(warn).not.toHaveBeenCalled();

      for (let i = 0; i < 5; i++) expect((await post(body(), {})).status).toBe(201);
      expect(warn).toHaveBeenCalled();
      // The clock is frozen, so every order has the same createdAt: compare the hashes as a multiset.
      const hashes = (await db.order.findMany()).map((o) => o.ipHash).sort();
      const expected = [hashIp("192.0.2.5", SECRET), ...Array(5).fill(hashIp("unknown", SECRET))].sort();
      expect(hashes).toEqual(expected);
      const res = await post(body(), {});
      expect(res.status).toBe(429);
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects a non-JSON content type and garbage bodies", async () => {
    const wrong = await POST(
      new Request("http://x/api/orders", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "a=b",
      }),
    );
    expect(wrong.status).toBe(422);
    expect((await post("not json{")).status).toBe(422);
    expect((await post([1, 2])).status).toBe(422);
    expect((await post(body({ items: "x" }))).status).toBe(422);
    expect(await db.order.count()).toBe(0);
  });

  it("fails closed with 500 when IP_HASH_SECRET is missing", async () => {
    delete process.env.IP_HASH_SECRET;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await post(body());
      expect(res.status).toBe(500);
      expect((await res.json()).message).toBe("提交失败，请稍后再试");
      expect(await db.order.count()).toBe(0);
    } finally {
      spy.mockRestore();
      process.env.IP_HASH_SECRET = SECRET;
    }
  });
});
