import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailMessage, MailTransport } from "@/server/mailer";
import { BACKOFF_MINUTES, processOutbox, sendNotification, type SendDeps } from "@/server/outboxSend";
import { db, resetDb } from "./helpers";

const NOW = new Date("2026-10-20T17:00:00Z");
const MIN = 60_000;

const render: NonNullable<SendDeps["render"]> = async (_db, n) => ({
  subject: `subject ${n.dedupeKey}`,
  text: `text ${n.kind}`,
});

function okTransport() {
  const calls: MailMessage[] = [];
  const t: MailTransport = {
    async send(msg) {
      calls.push(msg);
      return { id: `id_${calls.length}` };
    },
  };
  return { t, calls };
}
function failingTransport(message = "boom") {
  const t: MailTransport = {
    send: vi.fn(async () => {
      throw new Error(message);
    }),
  };
  return t;
}

function createNotification(
  over: { kind?: "NEW_ORDER" | "PASSWORD_RESET" | "CUSTOMER_CANCELLED"; dedupeKey?: string; payload?: object; nextAttemptAt?: Date; attempts?: number; status?: "PENDING" | "SENT" | "FAILED" } = {},
) {
  return db.notification.create({
    data: {
      kind: over.kind ?? "NEW_ORDER",
      dedupeKey: over.dedupeKey ?? `new_order:${crypto.randomUUID()}`,
      payload: over.payload ?? { orderId: "x" },
      nextAttemptAt: over.nextAttemptAt ?? NOW,
      attempts: over.attempts ?? 0,
      status: over.status ?? "PENDING",
      createdAt: NOW,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(async () => {
  await db.$disconnect();
});

describe("sendNotification", () => {
  it("success -> SENT with sentAt; dedupeKey is the idempotency key", async () => {
    const n = await createNotification({ dedupeKey: "new_order:o1" });
    const { t, calls } = okTransport();
    process.env.ADMIN_EMAIL = "owner@example.com";
    process.env.MAIL_FROM = "Bakery <orders@example.com>";
    try {
      expect(await sendNotification(db, n.id, NOW, { render, transport: t })).toBe("sent");
    } finally {
      delete process.env.ADMIN_EMAIL;
      delete process.env.MAIL_FROM;
    }
    expect(calls).toEqual([
      {
        to: "owner@example.com",
        from: "Bakery <orders@example.com>",
        subject: "subject new_order:o1",
        text: "text NEW_ORDER",
        idempotencyKey: "new_order:o1",
      },
    ]);
    const after = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.status).toBe("SENT");
    expect(after.sentAt).toEqual(NOW);
    expect(after.attempts).toBe(1);
    expect(after.lastError).toBeNull();
    expect(after.payload).toEqual({ orderId: "x" });
  });

  it("clears lastError of earlier failures on success", async () => {
    const n = await createNotification();
    await sendNotification(db, n.id, NOW, { render, transport: failingTransport() });
    const { t } = okTransport();
    expect(await sendNotification(db, n.id, new Date(NOW.getTime() + MIN), { render, transport: t })).toBe("sent");
    const after = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.attempts).toBe(2);
    expect(after.lastError).toBeNull();
  });

  it("password reset payload is scrubbed once sent", async () => {
    const n = await createNotification({
      kind: "PASSWORD_RESET",
      dedupeKey: "password_reset:r1",
      payload: { url: "https://x/admin/reset?token=secret" },
    });
    const { t, calls } = okTransport();
    expect(await sendNotification(db, n.id, NOW, { render, transport: t })).toBe("sent");
    expect(calls).toHaveLength(1);
    const after = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.payload).toEqual({ scrubbed: true });
  });

  it("failure -> attempts, lastError, nextAttemptAt per backoff; 8th failure -> FAILED", async () => {
    const n = await createNotification();
    const t = failingTransport("smtp exploded");
    let now = NOW;
    for (let i = 1; i <= 7; i++) {
      expect(await sendNotification(db, n.id, now, { render, transport: t })).toBe("failed");
      const row = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
      expect(row.status).toBe("PENDING");
      expect(row.attempts).toBe(i);
      expect(row.lastError).toContain("smtp exploded");
      expect(row.nextAttemptAt).toEqual(new Date(now.getTime() + BACKOFF_MINUTES[i - 1] * MIN));
      // Not due yet: skipped, nothing sent.
      expect(await sendNotification(db, n.id, new Date(row.nextAttemptAt.getTime() - 1), { render, transport: t })).toBe("skipped");
      now = row.nextAttemptAt;
    }
    expect(BACKOFF_MINUTES.slice(0, 7)).toEqual([1, 2, 5, 10, 30, 60, 120]);
    expect(await sendNotification(db, n.id, now, { render, transport: t })).toBe("failed");
    const row = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(8);
    expect(t.send).toHaveBeenCalledTimes(8);

    // FAILED is never retried.
    const later = new Date(now.getTime() + 365 * 24 * 60 * MIN);
    expect(await sendNotification(db, n.id, later, { render, transport: t })).toBe("skipped");
    expect(await processOutbox(db, later, { render, transport: t })).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(t.send).toHaveBeenCalledTimes(8);
  });

  it("render failure counts as a failure and nothing is sent", async () => {
    const n = await createNotification();
    const { t, calls } = okTransport();
    const badRender: SendDeps["render"] = async () => {
      throw new Error("template broke");
    };
    expect(await sendNotification(db, n.id, NOW, { render: badRender, transport: t })).toBe("failed");
    expect(calls).toHaveLength(0);
    const row = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain("template broke");
    expect(row.nextAttemptAt).toEqual(new Date(NOW.getTime() + MIN));
  });

  it("lastError is truncated to 500 chars and redacts the API key and recipient", async () => {
    process.env.RESEND_API_KEY = "re_topsecret_value";
    process.env.ADMIN_EMAIL = "owner@example.com";
    try {
      const n = await createNotification();
      const t = failingTransport(`bad re_topsecret_value owner@example.com ${"y".repeat(2000)}`);
      await sendNotification(db, n.id, NOW, { render, transport: t });
      const row = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
      expect(row.lastError!.length).toBeLessThanOrEqual(500);
      expect(row.lastError).not.toContain("re_topsecret_value");
      expect(row.lastError).not.toContain("owner@example.com");
    } finally {
      delete process.env.RESEND_API_KEY;
      delete process.env.ADMIN_EMAIL;
    }
  });

  it("SENT and unknown ids are skipped; never throws on a bad id", async () => {
    const n = await createNotification({ status: "SENT" });
    const { t, calls } = okTransport();
    expect(await sendNotification(db, n.id, NOW, { render, transport: t })).toBe("skipped");
    expect(await sendNotification(db, crypto.randomUUID(), NOW, { render, transport: t })).toBe("skipped");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendNotification(db, "not-a-uuid", NOW, { render, transport: t })).toBe("failed");
    expect(calls).toHaveLength(0);
  });
});

describe("processOutbox", () => {
  it("sends due PENDING only, oldest due first, up to limit", async () => {
    const a = await createNotification({ dedupeKey: "k:a", nextAttemptAt: new Date(NOW.getTime() - 2 * MIN) });
    const b = await createNotification({ dedupeKey: "k:b", nextAttemptAt: new Date(NOW.getTime() - 5 * MIN) });
    await createNotification({ dedupeKey: "k:future", nextAttemptAt: new Date(NOW.getTime() + MIN) });
    await createNotification({ dedupeKey: "k:failed", status: "FAILED" });
    await createNotification({ dedupeKey: "k:sent", status: "SENT" });
    const { t, calls } = okTransport();
    expect(await processOutbox(db, NOW, { render, transport: t }, 1)).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(calls.map((c) => c.idempotencyKey)).toEqual(["k:b"]);
    expect(await processOutbox(db, NOW, { render, transport: t })).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(calls.map((c) => c.idempotencyKey)).toEqual(["k:b", "k:a"]);
    expect((await db.notification.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("SENT");
    expect((await db.notification.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("SENT");
    // Repeated run: nothing more.
    expect(await processOutbox(db, NOW, { render, transport: t })).toEqual({ sent: 0, failed: 0, skipped: 0 });
  });

  it("a failure does not stop the rest", async () => {
    await createNotification({ dedupeKey: "k:1", nextAttemptAt: new Date(NOW.getTime() - 2 * MIN) });
    await createNotification({ dedupeKey: "k:2", nextAttemptAt: new Date(NOW.getTime() - MIN) });
    const sent: string[] = [];
    const t: MailTransport = {
      async send(m) {
        if (m.idempotencyKey === "k:1") throw new Error("nope");
        sent.push(m.idempotencyKey);
        return { id: "x" };
      },
    };
    expect(await processOutbox(db, NOW, { render, transport: t })).toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect(sent).toEqual(["k:2"]);
  });
});
