// Send-after-commit through the real route handlers, and POST /api/cron/outbox.
// next/server's after() is mocked to collect callbacks, which the test then awaits.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    afterCallbacks: [] as (() => unknown)[],
    transport: null as null | { send: (m: { idempotencyKey: string }) => Promise<{ id: string }> },
    sent: [] as string[],
  };
  return state;
});

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
  after: (cb: () => unknown) => {
    h.afterCallbacks.push(cb);
  },
}));
vi.mock("@/server/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/mailer")>()),
  getTransport: () => h.transport,
}));
vi.mock("@/server/emails", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/emails")>()),
  renderNotification: async (_db: unknown, n: { dedupeKey: string }) => ({ subject: n.dedupeKey, text: "t" }),
}));

import { POST as cancelPOST } from "@/app/api/o/[token]/cancel/route";
import { POST as cronPOST } from "@/app/api/cron/outbox/route";
import { POST as ordersPOST } from "@/app/api/orders/route";
import { POST as resetPOST } from "@/app/api/admin/password-reset/request/route";
import { prisma } from "@/server/db";
import { jsonRequest, NOW, SITE, tokenParams } from "./api.helpers";
import { createDefaultProducts, createOpenDate, createSettings, db, resetDb, type DefaultProductIds } from "./helpers";

const brokenTransport = {
  send: vi.fn(async () => {
    throw new Error("Resend responded 401: invalid key");
  }),
};
const goodTransport = {
  send: vi.fn(async (m: { idempotencyKey: string }) => {
    h.sent.push(m.idempotencyKey);
    return { id: "ok" };
  }),
};

async function runAfterCallbacks() {
  const cbs = h.afterCallbacks.splice(0);
  for (const cb of cbs) await cb();
  return cbs.length;
}

const ENV_KEYS = ["IP_HASH_SECRET", "CRON_SECRET", "SITE_URL"] as const;
const savedEnv: Record<string, string | undefined> = {};
let ids: DefaultProductIds;

beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.IP_HASH_SECRET = "test-secret";
  process.env.CRON_SECRET = "cron-secret-value";
  process.env.SITE_URL = SITE;
});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  h.afterCallbacks.length = 0;
  h.sent.length = 0;
  h.transport = goodTransport;
  brokenTransport.send.mockClear();
  goodTransport.send.mockClear();
  await resetDb();
  await createSettings({ orderingEnabled: true });
  ids = await createDefaultProducts();
  await createOpenDate("2026-10-22");
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await db.$disconnect();
  await prisma.$disconnect();
});

function orderBody(idempotencyKey: string = crypto.randomUUID()) {
  return {
    items: [{ productId: ids.redBean, qty: 2 }],
    pickupDate: "2026-10-22",
    fulfillment: "PICKUP",
    wechatId: "wx_outbox",
    note: "",
    idempotencyKey,
    website: "",
  };
}
const postOrder = (b: unknown) => ordersPOST(jsonRequest("/api/orders", b, { "x-forwarded-for": "203.0.113.9" }));
const cron = (auth?: string) =>
  cronPOST(new Request(SITE + "/api/cron/outbox", { method: "POST", headers: auth ? { authorization: auth } : {} }));

describe("send after commit", () => {
  it("order succeeds with a broken mailer; the cron sends it later", async () => {
    h.transport = brokenTransport;
    const res = await postOrder(orderBody());
    expect(res.status).toBe(201);
    expect(await db.order.count()).toBe(1);
    // The response was decided before any send was attempted.
    let n = await db.notification.findFirstOrThrow();
    expect(n.attempts).toBe(0);

    expect(await runAfterCallbacks()).toBe(1);
    expect(brokenTransport.send).toHaveBeenCalledTimes(1);
    n = await db.notification.findFirstOrThrow();
    expect(n.status).toBe("PENDING");
    expect(n.attempts).toBe(1);
    expect(n.lastError).toContain("401");
    expect(n.nextAttemptAt).toEqual(new Date(NOW.getTime() + 60_000));

    // Mailer fixed: the next cron run sends it.
    h.transport = goodTransport;
    vi.setSystemTime(new Date(NOW.getTime() + 5 * 60_000));
    const cronRes = await cron("Bearer cron-secret-value");
    expect(cronRes.status).toBe(200);
    expect((await cronRes.json()).outbox).toEqual({ sent: 1, failed: 0, skipped: 0 });
    n = await db.notification.findFirstOrThrow();
    expect(n.status).toBe("SENT");
    expect(n.attempts).toBe(2);
    expect(h.sent).toEqual([n.dedupeKey]);
  });

  it("the order still returns 201 when after() itself throws", async () => {
    // Not using the mock's collector: the real after() throws outside a request scope.
    const { after: realAfter } = await vi.importActual<typeof import("next/server")>("next/server");
    expect(() => realAfter(() => {})).toThrow();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    h.afterCallbacks.push = () => {
      throw new Error("after exploded");
    };
    try {
      const res = await postOrder(orderBody());
      expect(res.status).toBe(201);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("could not schedule send"));
    } finally {
      h.afterCallbacks.push = Array.prototype.push;
      error.mockRestore();
    }
    // Left to the cron.
    expect((await db.notification.findFirstOrThrow()).status).toBe("PENDING");
  });

  it("successful after-commit send; replay schedules nothing", async () => {
    const key = crypto.randomUUID();
    expect((await postOrder(orderBody(key))).status).toBe(201);
    await runAfterCallbacks();
    expect((await db.notification.findFirstOrThrow()).status).toBe("SENT");
    expect((await postOrder(orderBody(key))).status).toBe(200);
    expect(await runAfterCallbacks()).toBe(0);
    expect(goodTransport.send).toHaveBeenCalledTimes(1);
  });

  it("customer cancel sends its notification after commit", async () => {
    const created = await (await postOrder(orderBody())).json();
    await runAfterCallbacks();
    const res = await cancelPOST(jsonRequest(`/api/o/${created.viewToken}/cancel`, {}), tokenParams(created.viewToken));
    expect(res.status).toBe(200);
    expect(await runAfterCallbacks()).toBe(1);
    const n = await db.notification.findFirstOrThrow({ where: { kind: "CUSTOMER_CANCELLED" } });
    expect(n.status).toBe("SENT");
    // Cancelling again: no new notification, nothing scheduled.
    await cancelPOST(jsonRequest(`/api/o/${created.viewToken}/cancel`, {}), tokenParams(created.viewToken));
    expect(await runAfterCallbacks()).toBe(0);
  });

  it("password reset request sends after commit and scrubs the link", async () => {
    await db.adminUser.create({ data: { username: "owner", passwordHash: "x" } });
    const res = await resetPOST(new Request(SITE + "/api/admin/password-reset/request", { method: "POST", headers: { origin: SITE } }));
    expect(res.status).toBe(200);
    expect(await runAfterCallbacks()).toBe(1);
    const n = await db.notification.findFirstOrThrow({ where: { kind: "PASSWORD_RESET" } });
    expect(n.status).toBe("SENT");
    expect(n.payload).toEqual({ scrubbed: true });
  });
});

describe("POST /api/cron/outbox", () => {
  it("401 without or with a wrong bearer", async () => {
    for (const auth of [undefined, "Bearer wrong", "cron-secret-value", "Bearer cron-secret-valu"]) {
      const res = await cron(auth);
      expect(res.status).toBe(401);
    }
  });

  it("200 with counts; repeated calls are idempotent", async () => {
    h.transport = brokenTransport;
    await postOrder(orderBody());
    h.afterCallbacks.length = 0; // never ran: the cron picks it up
    h.transport = goodTransport;
    await db.rateLimitHit.create({ data: { key: "x", at: new Date(NOW.getTime() - 25 * 3600_000) } });

    const first = await cron("Bearer cron-secret-value");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      outbox: { sent: 1, failed: 0, skipped: 0 },
      cleanup: { rateLimitHits: 1, adminSessions: 0, passwordResets: 0, ordersIpHashCleared: 0 },
    });
    const second = await cron("Bearer cron-secret-value");
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      outbox: { sent: 0, failed: 0, skipped: 0 },
      cleanup: { rateLimitHits: 0, adminSessions: 0, passwordResets: 0, ordersIpHashCleared: 0 },
    });
    expect(goodTransport.send).toHaveBeenCalledTimes(1);
  });
});
