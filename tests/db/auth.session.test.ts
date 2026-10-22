import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createSession,
  getSession,
  hashPassword,
  hashToken,
  login,
  logout,
  SESSION_TTL_MS,
} from "@/server/auth";
import { db, resetDb } from "./helpers";

const T0 = new Date("2026-10-22T15:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60 * 1000;

async function createAdmin() {
  return db.adminUser.create({
    data: { username: "owner", passwordHash: await hashPassword("correct-horse-battery") },
  });
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("sessions", () => {
  it("stores only the sha256 of the token", async () => {
    const admin = await createAdmin();
    const { token } = await login(db, { username: "owner", password: "correct-horse-battery", now: T0 });
    const rows = await db.adminSession.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0].userId).toBe(admin.id);
  });

  it("is valid until expiresAt, then invalid", async () => {
    const admin = await createAdmin();
    const { token } = await createSession(db, admin.id, T0);
    const s = await getSession(db, token, at(SESSION_TTL_MS - 1));
    expect(s?.userId).toBe(admin.id);
    expect(s?.username).toBe("owner");
    expect(await getSession(db, token, at(SESSION_TTL_MS))).toBeNull();
    expect(await getSession(db, token, at(SESSION_TTL_MS + 1))).toBeNull();
  });

  it("rejects unknown or empty tokens", async () => {
    await createAdmin();
    expect(await getSession(db, "nope", T0)).toBeNull();
    expect(await getSession(db, "", T0)).toBeNull();
    expect(await getSession(db, undefined, T0)).toBeNull();
    expect(await getSession(db, "x".repeat(10_000), T0)).toBeNull();
  });

  it("updates lastSeenAt at most once per 5 minutes", async () => {
    const admin = await createAdmin();
    const { token } = await createSession(db, admin.id, T0);
    const lastSeen = async () =>
      (await db.adminSession.findFirstOrThrow()).lastSeenAt.toISOString();

    await getSession(db, token, at(4 * MIN));
    expect(await lastSeen()).toBe(T0.toISOString());
    await getSession(db, token, at(5 * MIN));
    expect(await lastSeen()).toBe(at(5 * MIN).toISOString());
    await getSession(db, token, at(9 * MIN));
    expect(await lastSeen()).toBe(at(5 * MIN).toISOString());
  });

  it("logout deletes the session", async () => {
    const admin = await createAdmin();
    const a = await createSession(db, admin.id, T0);
    const b = await createSession(db, admin.id, T0);
    await logout(db, a.token);
    expect(await getSession(db, a.token, at(1))).toBeNull();
    expect(await getSession(db, b.token, at(1))).not.toBeNull();
    await logout(db, "unknown-token"); // no-op
    await logout(db, null);
    expect(await db.adminSession.count()).toBe(1);
  });
});
