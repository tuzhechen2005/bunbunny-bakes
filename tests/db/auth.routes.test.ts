// Route handlers invoked directly with a Request. They use the app singleton
// (src/server/db.ts), which the db test project points at the test database.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// connection() needs a Next.js request scope; outside one it throws. Everything else
// from next/server (NextResponse, cookies) is the real implementation.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
import { POST as loginPOST } from "@/app/api/admin/login/route";
import { POST as logoutPOST } from "@/app/api/admin/logout/route";
import { POST as resetRequestPOST } from "@/app/api/admin/password-reset/request/route";
import { POST as resetConfirmPOST } from "@/app/api/admin/password-reset/confirm/route";
import { getSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { db, resetDb } from "./helpers";

const SITE = "https://bunbunnybakes.com";
const PASSWORD = "correct-horse-battery";
let previousSiteUrl: string | undefined;

function post(path: string, body: unknown, headers: Record<string, string> = { origin: SITE }) {
  return new Request(SITE + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

function sessionCookie(res: Response): string | null {
  const header = res.headers.getSetCookie().find((c) => c.startsWith("bb_session="));
  return header ?? null;
}

beforeAll(() => {
  previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = SITE;
});

beforeEach(async () => {
  await resetDb();
  await db.adminUser.create({
    data: { username: "owner", passwordHash: await hashPassword(PASSWORD) },
  });
});

afterAll(async () => {
  if (previousSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousSiteUrl;
  await db.$disconnect();
  await prisma.$disconnect();
});

describe("POST /api/admin/login", () => {
  it("sets the session cookie with the right attributes on success", async () => {
    const res = await loginPOST(post("/api/admin/login", { username: "owner", password: PASSWORD }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const cookie = sessionCookie(res);
    expect(cookie).not.toBeNull();
    const parts = cookie!.split(";").map((p) => p.trim().toLowerCase());
    const token = cookie!.split(";")[0].slice("bb_session=".length);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parts).toContain("httponly");
    expect(parts).toContain("secure"); // SITE_URL is https
    expect(parts).toContain("samesite=lax");
    expect(parts).toContain("path=/");
    expect(parts).toContain(`max-age=${30 * 24 * 60 * 60}`);
    expect(await getSession(db, token, new Date())).not.toBeNull();
  });

  it("is not Secure over plain http outside production", async () => {
    process.env.SITE_URL = "http://localhost:3000";
    try {
      const res = await loginPOST(
        new Request("http://localhost:3000/api/admin/login", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:3000" },
          body: JSON.stringify({ username: "owner", password: PASSWORD }),
        }),
      );
      expect(res.status).toBe(200);
      const parts = sessionCookie(res)!.split(";").map((p) => p.trim().toLowerCase());
      expect(parts).not.toContain("secure");
      expect(parts).toContain("httponly");
    } finally {
      process.env.SITE_URL = SITE;
    }
  });

  it("answers 401 with the generic message on a wrong password, without a cookie", async () => {
    const res = await loginPOST(post("/api/admin/login", { username: "owner", password: "wrong-one-x" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "UNAUTHORIZED", message: "用户名或密码错误" });
    expect(sessionCookie(res)).toBeNull();
  });

  it("answers 403 on a missing or foreign Origin and does not log in", async () => {
    const variants: Record<string, string>[] = [
      {},
      { origin: "https://evil.example" },
      { origin: "http://bunbunnybakes.com" },
    ];
    for (const headers of variants) {
      const res = await loginPOST(post("/api/admin/login", { username: "owner", password: PASSWORD }, headers));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "FORBIDDEN_ORIGIN" });
      expect(sessionCookie(res)).toBeNull();
    }
    expect(await db.adminSession.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("answers 422 VALIDATION on a bad body", async () => {
    for (const body of ["not json", { username: "owner" }, { username: "", password: "x" }]) {
      const res = await loginPOST(post("/api/admin/login", body));
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toBe("VALIDATION");
      expect(typeof json.message).toBe("string");
    }
  });
});

describe("POST /api/admin/logout", () => {
  it("deletes the session and clears the cookie", async () => {
    const loginRes = await loginPOST(post("/api/admin/login", { username: "owner", password: PASSWORD }));
    const token = sessionCookie(loginRes)!.split(";")[0].slice("bb_session=".length);
    const res = await logoutPOST(post("/api/admin/logout", undefined, { origin: SITE, cookie: `bb_session=${token}` }));
    expect(res.status).toBe(200);
    expect(sessionCookie(res)).toMatch(/Max-Age=0/i);
    expect(await getSession(db, token, new Date())).toBeNull();
  });

  it("answers 403 on a foreign Origin", async () => {
    const res = await logoutPOST(post("/api/admin/logout", undefined, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });
});

describe("password reset routes", () => {
  it("request always answers the same 200, even when rate limited", async () => {
    const bodies = [];
    for (let i = 0; i < 4; i++) {
      const res = await resetRequestPOST(post("/api/admin/password-reset/request", undefined));
      expect(res.status).toBe(200);
      bodies.push(await res.json());
    }
    for (const b of bodies) expect(b).toEqual({ ok: true, message: "重置链接已发送到你的邮箱" });
    expect(await db.passwordReset.count()).toBe(3);
    expect(await db.notification.count()).toBe(3);
  });

  it("request answers 403 on a foreign Origin and creates nothing", async () => {
    const res = await resetRequestPOST(post("/api/admin/password-reset/request", undefined, {}));
    expect(res.status).toBe(403);
    expect(await db.passwordReset.count()).toBe(0);
  });

  it("confirm: short password 422, bad token 422, then success", async () => {
    await resetRequestPOST(post("/api/admin/password-reset/request", undefined));
    const n = await db.notification.findFirstOrThrow();
    const token = new URL((n.payload as { url: string }).url).searchParams.get("token")!;

    const short = await resetConfirmPOST(post("/api/admin/password-reset/confirm", { token, newPassword: "short" }));
    expect(short.status).toBe(422);
    expect((await short.json()).message).toBe("密码至少 10 位");

    const bad = await resetConfirmPOST(post("/api/admin/password-reset/confirm", { token: "nope", newPassword: "long-enough-pw" }));
    expect(bad.status).toBe(422);

    const ok = await resetConfirmPOST(post("/api/admin/password-reset/confirm", { token, newPassword: "long-enough-pw" }));
    expect(ok.status).toBe(200);
    const again = await resetConfirmPOST(post("/api/admin/password-reset/confirm", { token, newPassword: "long-enough-pw2" }));
    expect(again.status).toBe(422);
  });
});
