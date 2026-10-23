// POST /api/cron/summary sends the nightly summary right away (not at the next
// 5-minute outbox run). Real renderer, fake transport.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sent: [] as { idempotencyKey: string; subject: string }[],
  fail: false,
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("@/server/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/mailer")>()),
  getTransport: () => ({
    async send(m: { idempotencyKey: string; subject: string }) {
      if (h.fail) throw new Error("provider down");
      h.sent.push({ idempotencyKey: m.idempotencyKey, subject: m.subject });
      return { id: "ok" };
    },
  }),
}));

import { POST as summaryPOST } from "@/app/api/cron/summary/route";
import { prisma } from "@/server/db";
import { createDefaultProducts, createOpenDate, createOrder, createSettings, db, resetDb } from "./helpers";

// 20:05 on 2026-10-29 in Chicago (CDT).
const NOW = new Date("2026-10-30T01:05:00Z");
const SECRET = "cron-secret-summary-send";
const saved = { SITE_URL: process.env.SITE_URL, CRON_SECRET: process.env.CRON_SECRET };

const req = () =>
  new Request("http://localhost/api/cron/summary", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  h.sent.length = 0;
  h.fail = false;
  process.env.SITE_URL = "https://bunbunnybakes.shop";
  process.env.CRON_SECRET = SECRET;
  await resetDb();
  await createSettings({ orderingEnabled: true });
  const ids = await createDefaultProducts();
  await createOpenDate("2026-10-30");
  await createOrder({ date: "2026-10-30", status: "CONFIRMED", items: [{ productId: ids.redBean, qty: 6 }] });
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await db.$disconnect();
  await prisma.$disconnect();
});

describe("POST /api/cron/summary sends at once", () => {
  it("enqueues and sends the summary in the same call; a repeat sends nothing", async () => {
    const res = await summaryPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "enqueued", send: "sent" });
    expect(h.sent).toEqual([{ idempotencyKey: "summary:2026-10-30", subject: expect.stringContaining("10/30") }]);
    const n = await db.notification.findFirstOrThrow();
    expect(n.id).toBe(body.notificationId);
    expect(n.status).toBe("SENT");
    expect(n.sentAt).toEqual(NOW);

    const again = await summaryPOST(req());
    expect(await again.json()).toEqual({ status: "duplicate" });
    expect(h.sent).toHaveLength(1);
  });

  it("a send failure still answers 200; the outbox cron retries it", async () => {
    h.fail = true;
    const res = await summaryPOST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "enqueued", send: "failed" });
    const n = await db.notification.findFirstOrThrow();
    expect(n.status).toBe("PENDING");
    expect(n.attempts).toBe(1);
    expect(n.lastError).toContain("provider down");
  });
});
