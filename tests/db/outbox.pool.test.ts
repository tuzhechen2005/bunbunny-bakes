// A hanging mail provider must not hold database connections (CLAUDE.md rule 7):
// with a 2-connection pool and two sends stuck in the network call, an order still
// goes through at once.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient, DEFAULT_CONNECTION_TIMEOUT_MS } from "@/server/db";
import type { MailTransport } from "@/server/mailer";
import { createCustomerOrder } from "@/server/orders";
import { sendNotification, type SendDeps } from "@/server/outboxSend";
import { createDefaultProducts, createOpenDate, createSettings, db, resetDb, TEST_DATABASE_URL } from "./helpers";
import { DB_TEST_REMOTE } from "./testDbUrl";

const NOW = new Date("2026-10-20T17:00:00Z");
const small = createPrismaClient(TEST_DATABASE_URL, { max: 2 });
const render: NonNullable<SendDeps["render"]> = async (_db, n) => ({ subject: n.dedupeKey, text: "t" });

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await Promise.all([small.$disconnect(), db.$disconnect()]);
});

describe("outbox send and the connection pool", () => {
  it("two sends hanging 3 s in the transport do not block an order", async () => {
    await createSettings({ orderingEnabled: true });
    const ids = await createDefaultProducts();
    await createOpenDate("2026-10-22");
    const notes = [];
    for (let i = 0; i < 2; i++) {
      notes.push(
        await db.notification.create({
          data: { kind: "NEW_ORDER", dedupeKey: `k:${i}`, payload: {}, nextAttemptAt: NOW, createdAt: NOW },
        }),
      );
    }
    let inTransport = 0;
    const hanging: MailTransport = {
      async send() {
        inTransport += 1;
        await new Promise((r) => setTimeout(r, 3000));
        return { id: "x" };
      },
    };
    const sends = notes.map((n) => sendNotification(small, n.id, NOW, { render, transport: hanging }));
    while (inTransport < 2) await new Promise((r) => setTimeout(r, 10));

    const started = Date.now();
    const order = await createCustomerOrder(
      small,
      { items: [{ productId: ids.redBean, qty: 1 }], pickupDate: "2026-10-22", fulfillment: "PICKUP", wechatId: "wx_pool" },
      NOW,
    );
    const elapsed = Date.now() - started;
    expect(order.orderNo).toBe("1022-001");
    expect(elapsed).toBeLessThan(1500);

    expect(await Promise.all(sends)).toEqual(["sent", "sent"]);
  });
});

describe("pool connection timeout", () => {
  it("defaults to 5 s", () => {
    expect(DEFAULT_CONNECTION_TIMEOUT_MS).toBe(5000);
    expect(() => createPrismaClient(TEST_DATABASE_URL, { connectionTimeoutMillis: 0 })).toThrow(/connectionTimeoutMillis/);
  });

  // Skipped with DB_TEST_REMOTE=1: the 300 ms connectionTimeout also bounds opening the pool's
  // first connection, and a TLS connect to a remote server (Neon over the internet) takes
  // longer than that, so the holder transaction itself fails. The behaviour under test (pg
  // waits at most connectionTimeoutMillis for a busy pool) does not depend on the server.
  it.skipIf(DB_TEST_REMOTE)("a query waiting for a busy pool fails after the timeout instead of waiting forever", async () => {
    const one = createPrismaClient(TEST_DATABASE_URL, { max: 1, connectionTimeoutMillis: 300 });
    try {
      const holder = one.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_sleep(1.5)`;
      }, { timeout: 10_000 });
      await new Promise((r) => setTimeout(r, 100));
      const started = Date.now();
      await expect(one.$queryRaw`SELECT 1`).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(1200);
      await holder;
    } finally {
      await one.$disconnect();
    }
  });
});
