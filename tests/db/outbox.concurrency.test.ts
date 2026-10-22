// No double send: two overlapping outbox runs on separate clients (CLAUDE.md rule 7,
// NOTIFICATIONS §1.5). Real Postgres row locks, not mocks.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/server/db";
import type { MailTransport } from "@/server/mailer";
import { processOutbox, type SendDeps } from "@/server/outboxSend";
import { db, resetDb, TEST_DATABASE_URL } from "./helpers";

const NOW = new Date("2026-10-20T17:00:00Z");
const clientA = createPrismaClient(TEST_DATABASE_URL, { max: 5 });
const clientB = createPrismaClient(TEST_DATABASE_URL, { max: 5 });

const render: NonNullable<SendDeps["render"]> = async (_db, n) => ({ subject: n.dedupeKey, text: "t" });

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await Promise.all([clientA.$disconnect(), clientB.$disconnect(), db.$disconnect()]);
});

describe("processOutbox concurrency", () => {
  it("two overlapping runs send each of 20 notifications exactly once", async () => {
    for (let i = 0; i < 20; i++) {
      await db.notification.create({
        data: {
          kind: "NEW_ORDER",
          dedupeKey: `new_order:${i}`,
          payload: {},
          nextAttemptAt: new Date(NOW.getTime() - (20 - i) * 1000),
          createdAt: NOW,
        },
      });
    }
    const sends = new Map<string, number>();
    const slow: MailTransport = {
      async send(msg) {
        sends.set(msg.idempotencyKey, (sends.get(msg.idempotencyKey) ?? 0) + 1);
        await new Promise((r) => setTimeout(r, 25));
        return { id: msg.idempotencyKey };
      },
    };
    const [a, b] = await Promise.all([
      processOutbox(clientA, NOW, { render, transport: slow }),
      processOutbox(clientB, NOW, { render, transport: slow }),
    ]);
    // How the work splits between the runs (and how many each skips) depends on timing;
    // only "every notification exactly once" is the invariant.
    const keys = Array.from({ length: 20 }, (_, i) => `new_order:${i}`);
    expect(Object.fromEntries(keys.map((k) => [k, sends.get(k) ?? 0]))).toEqual(
      Object.fromEntries(keys.map((k) => [k, 1])),
    );
    expect(sends.size).toBe(20);
    expect(a.sent + b.sent).toBe(20);
    expect(a.failed + b.failed).toBe(0);
    expect(await db.notification.count({ where: { status: "SENT" } })).toBe(20);
    const rows = await db.notification.findMany();
    expect(rows.every((r) => r.attempts === 1)).toBe(true);
  });
});
