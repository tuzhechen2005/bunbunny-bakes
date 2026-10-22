import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  changePassword,
  confirmPasswordReset,
  createSession,
  getSession,
  hashPassword,
  hashToken,
  login,
  RESET_TTL_MS,
  requestPasswordReset,
} from "@/server/auth";
import * as outbox from "@/server/outbox";
import { isAppError } from "@/server/errors";
import { db, resetDb } from "./helpers";

const SITE = "https://bunbunnybakes.com";
const T0 = new Date("2026-10-22T15:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60 * 1000;
const OLD_PASSWORD = "correct-horse-battery";
const NEW_PASSWORD = "brand-new-password-42";

async function createAdmin() {
  return db.adminUser.create({
    data: { username: "owner", passwordHash: await hashPassword(OLD_PASSWORD) },
  });
}

/** Creates a reset and returns the raw token from the queued notification URL. */
async function resetToken(now = T0): Promise<string> {
  const result = await requestPasswordReset(db, { siteUrl: SITE, now });
  expect(result.status).toBe("created");
  if (result.status !== "created") throw new Error("unreachable");
  const n = await db.notification.findUniqueOrThrow({
    where: { dedupeKey: `password_reset:${result.resetId}` },
  });
  const url = new URL((n.payload as { url: string }).url);
  return url.searchParams.get("token")!;
}

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a failure");
}

beforeEach(async () => {
  await resetDb();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("requestPasswordReset", () => {
  it("creates a hashed token and a PASSWORD_RESET notification with the link", async () => {
    const admin = await createAdmin();
    const result = await requestPasswordReset(db, { siteUrl: SITE + "/", now: T0 });
    expect(result.status).toBe("created");
    if (result.status !== "created") return;

    const reset = await db.passwordReset.findUniqueOrThrow({ where: { id: result.resetId } });
    expect(reset.userId).toBe(admin.id);
    expect(reset.expiresAt.toISOString()).toBe(at(RESET_TTL_MS).toISOString());
    expect(reset.usedAt).toBeNull();

    const n = await db.notification.findUniqueOrThrow({
      where: { dedupeKey: `password_reset:${reset.id}` },
    });
    expect(n.kind).toBe("PASSWORD_RESET");
    expect(n.status).toBe("PENDING");
    const url = (n.payload as { url: string }).url;
    expect(url).toMatch(/^https:\/\/bunbunnybakes\.com\/admin\/reset\?token=[A-Za-z0-9_-]{43}$/);
    const token = new URL(url).searchParams.get("token")!;
    expect(reset.tokenHash).toBe(hashToken(token));
    expect(reset.tokenHash).not.toBe(token);
  });

  it("writes the reset and the notification in one transaction", async () => {
    await createAdmin();
    vi.spyOn(outbox, "enqueueNotification").mockRejectedValueOnce(new Error("boom"));
    await expect(requestPasswordReset(db, { siteUrl: SITE, now: T0 })).rejects.toThrow("boom");
    expect(await db.passwordReset.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
    expect(await db.rateLimitHit.count()).toBe(0);
  });

  it("allows 3 per hour; the 4th creates nothing", async () => {
    await createAdmin();
    for (let i = 0; i < 3; i++) {
      expect((await requestPasswordReset(db, { siteUrl: SITE, now: at(i * MIN) })).status).toBe(
        "created",
      );
    }
    expect((await requestPasswordReset(db, { siteUrl: SITE, now: at(59 * MIN) })).status).toBe(
      "rate_limited",
    );
    expect(await db.passwordReset.count()).toBe(3);
    expect(await db.notification.count()).toBe(3);
    // An hour after the first one, a slot is free again.
    expect((await requestPasswordReset(db, { siteUrl: SITE, now: at(60 * MIN) })).status).toBe(
      "created",
    );
  });

  it("enforces the limit under concurrency", async () => {
    await createAdmin();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => requestPasswordReset(db, { siteUrl: SITE, now: T0 })),
    );
    expect(results.filter((r) => r.status === "created")).toHaveLength(3);
    expect(await db.passwordReset.count()).toBe(3);
  });

  it("does nothing without an admin", async () => {
    expect((await requestPasswordReset(db, { siteUrl: SITE, now: T0 })).status).toBe("no_admin");
    expect(await db.notification.count()).toBe(0);
  });
});

describe("confirmPasswordReset", () => {
  it("sets the password, removes all sessions, clears the lockout and audits", async () => {
    const admin = await createAdmin();
    await createSession(db, admin.id, T0);
    await createSession(db, admin.id, T0);
    await db.adminUser.update({
      where: { id: admin.id },
      data: { failedCount: 5, lockedUntil: at(10 * MIN) },
    });
    const token = await resetToken();

    await confirmPasswordReset(db, { token, newPassword: NEW_PASSWORD, now: at(MIN) });

    expect(await db.adminSession.count()).toBe(0);
    const user = await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(user.failedCount).toBe(0);
    expect(user.lockedUntil).toBeNull();
    const reset = await db.passwordReset.findFirstOrThrow();
    expect(reset.usedAt?.toISOString()).toBe(at(MIN).toISOString());
    const audit = await db.auditLog.findMany({ where: { action: "admin.password_reset" } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);

    // New password works (while the old lock would still be active), old one does not.
    await expect(login(db, { username: "owner", password: OLD_PASSWORD, now: at(2 * MIN) })).rejects.toThrow();
    const ok = await login(db, { username: "owner", password: NEW_PASSWORD, now: at(2 * MIN) });
    expect(ok.token).toBeTruthy();
  });

  it("is single use", async () => {
    await createAdmin();
    const token = await resetToken();
    await confirmPasswordReset(db, { token, newPassword: NEW_PASSWORD, now: at(MIN) });
    const e = await errorOf(
      confirmPasswordReset(db, { token, newPassword: "another-password-1", now: at(2 * MIN) }),
    );
    expect(isAppError(e) && e.code).toBe("VALIDATION");
    await login(db, { username: "owner", password: NEW_PASSWORD, now: at(3 * MIN) });
  });

  it("is single use under concurrency", async () => {
    await createAdmin();
    const token = await resetToken();
    const results = await Promise.allSettled([
      confirmPasswordReset(db, { token, newPassword: "first-password-1", now: at(MIN) }),
      confirmPasswordReset(db, { token, newPassword: "second-password-2", now: at(MIN) }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("rejects an expired token", async () => {
    await createAdmin();
    const token = await resetToken();
    const e = await errorOf(
      confirmPasswordReset(db, { token, newPassword: NEW_PASSWORD, now: at(RESET_TTL_MS) }),
    );
    expect(isAppError(e) && e.code).toBe("VALIDATION");
    expect(isAppError(e) && e.message).toBe("重置链接无效或已过期，请重新申请");
    await login(db, { username: "owner", password: OLD_PASSWORD, now: at(RESET_TTL_MS) });
  });

  it("rejects an unknown token", async () => {
    await createAdmin();
    const e = await errorOf(
      confirmPasswordReset(db, { token: "made-up", newPassword: NEW_PASSWORD, now: T0 }),
    );
    expect(isAppError(e) && e.code).toBe("VALIDATION");
  });

  it("rejects a short password and keeps the token usable", async () => {
    await createAdmin();
    const token = await resetToken();
    const e = await errorOf(
      confirmPasswordReset(db, { token, newPassword: "123456789", now: at(MIN) }),
    );
    expect(isAppError(e) && e.code).toBe("VALIDATION");
    expect(isAppError(e) && e.message).toBe("密码至少 10 位");
    expect((await db.passwordReset.findFirstOrThrow()).usedAt).toBeNull();
    await confirmPasswordReset(db, { token, newPassword: "1234567890", now: at(MIN) });
  });

  it("using one link invalidates the user's other outstanding links", async () => {
    await createAdmin();
    const first = await resetToken(T0);
    const second = await resetToken(at(MIN));
    await confirmPasswordReset(db, { token: second, newPassword: NEW_PASSWORD, now: at(2 * MIN) });
    const e = await errorOf(
      confirmPasswordReset(db, { token: first, newPassword: "another-password-1", now: at(3 * MIN) }),
    );
    expect(isAppError(e) && e.code).toBe("VALIDATION");
  });
});

describe("changePassword", () => {
  it("keeps only the current session", async () => {
    const admin = await createAdmin();
    const current = await createSession(db, admin.id, T0);
    const other1 = await createSession(db, admin.id, T0);
    const other2 = await createSession(db, admin.id, T0);

    await changePassword(db, {
      userId: admin.id,
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      keepSessionTokenHash: hashToken(current.token),
      now: at(MIN),
    });

    expect(await getSession(db, current.token, at(2 * MIN))).not.toBeNull();
    expect(await getSession(db, other1.token, at(2 * MIN))).toBeNull();
    expect(await getSession(db, other2.token, at(2 * MIN))).toBeNull();
    const audit = await db.auditLog.findMany({ where: { action: "admin.password_change" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe("ADMIN");
    await login(db, { username: "owner", password: NEW_PASSWORD, now: at(3 * MIN) });
  });

  it("rejects a wrong current password and changes nothing", async () => {
    const admin = await createAdmin();
    const current = await createSession(db, admin.id, T0);
    const other = await createSession(db, admin.id, T0);
    const e = await errorOf(
      changePassword(db, {
        userId: admin.id,
        currentPassword: "not-the-password",
        newPassword: NEW_PASSWORD,
        keepSessionTokenHash: hashToken(current.token),
        now: at(MIN),
      }),
    );
    expect(isAppError(e) && e.code).toBe("VALIDATION");
    expect(await getSession(db, other.token, at(2 * MIN))).not.toBeNull();
    await login(db, { username: "owner", password: OLD_PASSWORD, now: at(3 * MIN) });
  });

  it("rejects a short new password", async () => {
    const admin = await createAdmin();
    const current = await createSession(db, admin.id, T0);
    const e = await errorOf(
      changePassword(db, {
        userId: admin.id,
        currentPassword: OLD_PASSWORD,
        newPassword: "short",
        keepSessionTokenHash: hashToken(current.token),
        now: at(MIN),
      }),
    );
    expect(isAppError(e) && e.code).toBe("VALIDATION");
  });
});
