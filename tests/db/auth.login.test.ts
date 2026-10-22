import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, login, LOCKOUT_MS } from "@/server/auth";
import { isAppError } from "@/server/errors";
import { db, resetDb } from "./helpers";

const USERNAME = "owner";
const PASSWORD = "correct-horse-battery";
const T0 = new Date("2026-10-22T15:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

async function createAdmin() {
  return db.adminUser.create({
    data: { username: USERNAME, passwordHash: await hashPassword(PASSWORD) },
  });
}

/** The thrown error of a failed login (asserts it fails). */
async function loginError(username: string, password: string, now: Date) {
  try {
    await login(db, { username, password, now });
  } catch (e) {
    return e;
  }
  throw new Error("expected login to fail");
}

function expectInvalidCredentials(e: unknown) {
  expect(isAppError(e)).toBe(true);
  if (!isAppError(e)) return;
  expect(e.code).toBe("UNAUTHORIZED");
  expect(e.httpStatus).toBe(401);
  expect(e.message).toBe("用户名或密码错误");
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("login", () => {
  it("succeeds with the right password, creates a session and an audit row", async () => {
    const admin = await createAdmin();
    const result = await login(db, { username: USERNAME, password: PASSWORD, now: T0 });
    expect(result.userId).toBe(admin.id);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt.toISOString()).toBe(at(30 * 24 * 3600 * 1000).toISOString());
    expect(await db.adminSession.count({ where: { userId: admin.id } })).toBe(1);
    const audit = await db.auditLog.findMany({ where: { action: "admin.login" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe("ADMIN");
    expect(audit[0].entityId).toBe(admin.id);
  });

  it("locks after 5 wrong passwords; the right one fails with the same message until 15 min pass", async () => {
    await createAdmin();
    for (let i = 0; i < 5; i++) {
      expectInvalidCredentials(await loginError(USERNAME, "wrong-password", at(i * 1000)));
    }
    const locked = await db.adminUser.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(locked.failedCount).toBe(5);
    expect(locked.lockedUntil?.toISOString()).toBe(at(4000 + LOCKOUT_MS).toISOString());

    // 6th attempt with the right password: same error.
    expectInvalidCredentials(await loginError(USERNAME, PASSWORD, at(10_000)));
    // Still locked one ms before the end.
    expectInvalidCredentials(await loginError(USERNAME, PASSWORD, at(4000 + LOCKOUT_MS - 1)));
    expect(await db.adminSession.count()).toBe(0);

    // After the lock: success, counters reset.
    const ok = await login(db, { username: USERNAME, password: PASSWORD, now: at(4000 + LOCKOUT_MS) });
    expect(ok.token).toBeTruthy();
    const after = await db.adminUser.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(after.failedCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it("a success resets the consecutive failure count", async () => {
    await createAdmin();
    for (let i = 0; i < 4; i++) await loginError(USERNAME, "nope-nope-nope", at(i));
    await login(db, { username: USERNAME, password: PASSWORD, now: at(10) });
    for (let i = 0; i < 4; i++) await loginError(USERNAME, "nope-nope-nope", at(20 + i));
    const user = await db.adminUser.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(user.failedCount).toBe(4);
    expect(user.lockedUntil).toBeNull();
  });

  it("an expired lock starts a fresh count (one more failure does not relock)", async () => {
    await createAdmin();
    for (let i = 0; i < 5; i++) await loginError(USERNAME, "wrong-password", at(i));
    await loginError(USERNAME, "wrong-password", at(LOCKOUT_MS + 10));
    const user = await db.adminUser.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(user.failedCount).toBe(1);
    expect(user.lockedUntil).toBeNull();
  });

  it("failures while locked do not extend the lock", async () => {
    await createAdmin();
    for (let i = 0; i < 5; i++) await loginError(USERNAME, "wrong-password", at(i));
    await loginError(USERNAME, "wrong-password", at(60_000));
    const user = await db.adminUser.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(user.lockedUntil?.toISOString()).toBe(at(4 + LOCKOUT_MS).toISOString());
  });

  it("an unknown user gets the same error", async () => {
    await createAdmin();
    expectInvalidCredentials(await loginError("someone-else", PASSWORD, T0));
    const audit = await db.auditLog.findMany({ where: { action: "admin.login_failed" } });
    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe("SYSTEM");
    expect(audit[0].after).toEqual({ username: "someone-else" });
  });

  it("failure audit rows never contain the password", async () => {
    await createAdmin();
    const secret = "my-secret-guess-123";
    for (let i = 0; i < 6; i++) await loginError(USERNAME, secret, at(i));
    await loginError("ghost", secret, at(10));
    const rows = await db.auditLog.findMany({ where: { action: "admin.login_failed" } });
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.actor).toBe("SYSTEM");
      expect(JSON.stringify(row)).not.toContain(secret);
      expect(Object.keys(row.after as object)).toEqual(["username"]);
    }
    // Success rows neither.
    await login(db, { username: USERNAME, password: PASSWORD, now: at(LOCKOUT_MS * 2) });
    const all = await db.auditLog.findMany();
    expect(JSON.stringify(all)).not.toContain(PASSWORD);
  });

  it("counts concurrent failures exactly", async () => {
    await createAdmin();
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => loginError(USERNAME, "wrong-password", at(i))),
    );
    const user = await db.adminUser.findUniqueOrThrow({ where: { username: USERNAME } });
    expect(user.failedCount).toBe(5);
    expect(user.lockedUntil).not.toBeNull();
  });
});
