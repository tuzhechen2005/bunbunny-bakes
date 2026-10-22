import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MailMessage, MailTransport } from "@/server/mailer";
import type { DbClient } from "@/server/db";
import {
  BACKOFF_MINUTES,
  LEASE_MS,
  MAX_ATTEMPTS,
  OUTBOX_BUDGET_MS,
  processOutbox,
  sendNotification,
  type SendDeps,
} from "@/server/outboxSend";
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
    expect(await processOutbox(db, later, { render, transport: t })).toEqual({ sent: 0, failed: 0, skipped: 0, deferred: 0 });
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

/** `client` whose notification.updateMany always throws (the finish step fails). */
function withBrokenFinish(client: DbClient): DbClient {
  const notification = new Proxy(client.notification, {
    get(t, p) {
      if (p === "updateMany") {
        return async () => {
          throw new Error("db write failed");
        };
      }
      return Reflect.get(t, p, t);
    },
  });
  return new Proxy(client, {
    get(t, p) {
      if (p === "notification") return notification;
      const v = Reflect.get(t, p, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

/** A transport whose sends block until the test settles them (gates[i] for call i). */
function gatedTransport() {
  const calls: string[] = [];
  const gates: { resolve: () => void; reject: (e: Error) => void }[] = [];
  const t: MailTransport = {
    send(m) {
      calls.push(m.idempotencyKey);
      return new Promise((resolve, reject) => {
        gates.push({ resolve: () => resolve({ id: "x" }), reject });
      });
    },
  };
  const waitForCall = async (n: number) => {
    while (gates.length < n) await new Promise((r) => setTimeout(r, 5));
  };
  return { t, calls, gates, waitForCall };
}

describe("fencing by the claim's attempt number", () => {
  it("a late failure does not overwrite a newer claim's lease", async () => {
    const n = await createNotification();
    const g = gatedTransport();
    const late = sendNotification(db, n.id, NOW, { render, transport: g.t }); // attempt 1
    await g.waitForCall(1);
    const t2 = new Date(NOW.getTime() + LEASE_MS); // lease 1 expired
    const newer = sendNotification(db, n.id, t2, { render, transport: g.t }); // attempt 2
    await g.waitForCall(2);

    g.gates[0].reject(new Error("late failure"));
    expect(await late).toBe("failed");
    let row = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.attempts).toBe(2);
    expect(row.nextAttemptAt).toEqual(new Date(t2.getTime() + LEASE_MS));
    expect(row.lastError).toBeNull();

    g.gates[1].resolve();
    expect(await newer).toBe("sent");
    row = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.status).toBe("SENT");
    expect(row.sentAt).toEqual(t2);
  });

  it("a late success does not finish a row a newer claim owns; the newer claim finishes it", async () => {
    const n = await createNotification();
    const g = gatedTransport();
    const late = sendNotification(db, n.id, NOW, { render, transport: g.t });
    await g.waitForCall(1);
    const t2 = new Date(NOW.getTime() + LEASE_MS);
    const newer = sendNotification(db, n.id, t2, { render, transport: g.t });
    await g.waitForCall(2);
    g.gates[0].resolve();
    await late;
    expect((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("PENDING");
    g.gates[1].reject(new Error("newer failed"));
    expect(await newer).toBe("failed");
    const row = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.attempts).toBe(2);
    expect(row.lastError).toContain("newer failed");
    expect(row.nextAttemptAt).toEqual(new Date(t2.getTime() + BACKOFF_MINUTES[1] * MIN));
    // Both used the same Idempotency-Key, so the provider delivered it once.
    expect(g.calls).toEqual([n.dedupeKey, n.dedupeKey]);
  });

  it("a confirmed send moves a row given up meanwhile from FAILED to SENT", async () => {
    const n = await createNotification({
      attempts: MAX_ATTEMPTS - 1,
      kind: "PASSWORD_RESET",
      dedupeKey: "password_reset:late",
      payload: { url: "https://x/admin/reset?token=secret" },
    });
    const g = gatedTransport();
    const last = sendNotification(db, n.id, NOW, { render, transport: g.t }); // attempt 8
    await g.waitForCall(1);
    // The lease runs out: the next claim gives up.
    expect(await sendNotification(db, n.id, new Date(NOW.getTime() + LEASE_MS), { render, transport: g.t })).toBe("failed");
    expect((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("FAILED");
    g.gates[0].resolve();
    expect(await last).toBe("sent");
    const row = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.status).toBe("SENT");
    expect(row.sentAt).toEqual(NOW);
    expect(row.lastError).toBeNull();
    expect(row.payload).toEqual({ scrubbed: true });
    expect(g.calls).toHaveLength(1);
  });
});

describe("every attempt counts (no endless retries)", () => {
  it("a thrown non-Error counts as a failed attempt", async () => {
    const n = await createNotification();
    const t: MailTransport = {
      async send() {
        throw "plain string";
      },
    };
    expect(await sendNotification(db, n.id, NOW, { render, transport: t })).toBe("failed");
    const row = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("plain string");
  });

  it("when the finish step itself fails, the attempt is still counted and the row ends FAILED", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const n = await createNotification({
      kind: "PASSWORD_RESET",
      dedupeKey: "password_reset:crash",
      payload: { url: "https://x/admin/reset?token=secret" },
    });
    const { t, calls } = okTransport();
    const broken = withBrokenFinish(db);
    let now = NOW;
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      expect(await sendNotification(broken, n.id, now, { render, transport: t })).toBe("failed");
      const row = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
      expect(row.status).toBe("PENDING");
      expect(row.attempts).toBe(i);
      // Leased: nobody else may claim it until the lease runs out.
      expect(row.nextAttemptAt).toEqual(new Date(now.getTime() + LEASE_MS));
      expect(await sendNotification(db, n.id, new Date(now.getTime() + LEASE_MS - 1), { render, transport: t })).toBe(
        "skipped",
      );
      now = row.nextAttemptAt;
    }
    expect(calls).toHaveLength(MAX_ATTEMPTS);
    // Attempts used up: given up without another send.
    expect(await sendNotification(broken, n.id, now, { render, transport: t })).toBe("failed");
    expect(calls).toHaveLength(MAX_ATTEMPTS);
    const row = await db.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.lastError).toMatch(/gave up after 8 attempts/);
    expect(row.payload).toEqual({ scrubbed: true });
    expect(calls.every((c) => c.idempotencyKey === "password_reset:crash")).toBe(true);
  });

  it("a send already in flight holds a lease: a second sender skips it", async () => {
    const n = await createNotification();
    let release!: () => void;
    let entered!: () => void;
    const inSend = new Promise<void>((r) => (entered = r));
    const calls: string[] = [];
    const slow: MailTransport = {
      async send(m) {
        calls.push(m.idempotencyKey);
        entered();
        await new Promise<void>((r) => (release = r));
        return { id: "x" };
      },
    };
    const first = sendNotification(db, n.id, NOW, { render, transport: slow });
    await inSend;
    expect(await sendNotification(db, n.id, NOW, { render, transport: slow })).toBe("skipped");
    expect(await processOutbox(db, new Date(NOW.getTime() + LEASE_MS - 1), { render, transport: slow })).toEqual({
      sent: 0,
      failed: 0,
      skipped: 0,
      deferred: 0,
    });
    release();
    expect(await first).toBe("sent");
    expect(calls).toHaveLength(1);
    expect((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).attempts).toBe(1);
  });
});

describe("processOutbox", () => {
  it("stops starting new sends once the time budget is used", async () => {
    for (let i = 0; i < 5; i++) {
      await createNotification({ dedupeKey: `k:${i}`, nextAttemptAt: new Date(NOW.getTime() - (5 - i) * 1000) });
    }
    let t = 0;
    const sent: string[] = [];
    const slow: MailTransport = {
      async send(m) {
        t += 7_000;
        sent.push(m.idempotencyKey);
        return { id: "x" };
      },
    };
    expect(OUTBOX_BUDGET_MS).toBe(20_000);
    const counts = await processOutbox(db, NOW, { render, transport: slow, clock: () => t });
    expect(counts).toEqual({ sent: 3, failed: 0, skipped: 0, deferred: 2 });
    expect(sent).toEqual(["k:0", "k:1", "k:2"]);
    expect(await db.notification.count({ where: { status: "PENDING" } })).toBe(2);
  });

  it("sends due PENDING only, oldest due first, up to limit", async () => {
    const a = await createNotification({ dedupeKey: "k:a", nextAttemptAt: new Date(NOW.getTime() - 2 * MIN) });
    const b = await createNotification({ dedupeKey: "k:b", nextAttemptAt: new Date(NOW.getTime() - 5 * MIN) });
    await createNotification({ dedupeKey: "k:future", nextAttemptAt: new Date(NOW.getTime() + MIN) });
    await createNotification({ dedupeKey: "k:failed", status: "FAILED" });
    await createNotification({ dedupeKey: "k:sent", status: "SENT" });
    const { t, calls } = okTransport();
    expect(await processOutbox(db, NOW, { render, transport: t }, 1)).toEqual({ sent: 1, failed: 0, skipped: 0, deferred: 0 });
    expect(calls.map((c) => c.idempotencyKey)).toEqual(["k:b"]);
    expect(await processOutbox(db, NOW, { render, transport: t })).toEqual({ sent: 1, failed: 0, skipped: 0, deferred: 0 });
    expect(calls.map((c) => c.idempotencyKey)).toEqual(["k:b", "k:a"]);
    expect((await db.notification.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("SENT");
    expect((await db.notification.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("SENT");
    // Repeated run: nothing more.
    expect(await processOutbox(db, NOW, { render, transport: t })).toEqual({ sent: 0, failed: 0, skipped: 0, deferred: 0 });
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
    expect(await processOutbox(db, NOW, { render, transport: t })).toEqual({ sent: 1, failed: 1, skipped: 0, deferred: 0 });
    expect(sent).toEqual(["k:2"]);
  });
});
