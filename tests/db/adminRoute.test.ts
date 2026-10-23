// adminHandler(): Origin check, database-validated session, error mapping.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// connection() needs a Next.js request scope; cookies() is replaced by a per-test token.
let cookieToken: string | undefined;
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "bb_session" && cookieToken !== undefined ? { name, value: cookieToken } : undefined,
  }),
}));

import { adminHandler, parseQuery } from "@/server/adminRoute";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { db, resetDb } from "./helpers";

const SITE = "https://bunbunnybakes.shop";
let previousSiteUrl: string | undefined;
let userId: string;

function req(method: string, headers: Record<string, string> = {}, path = "/api/admin/x") {
  return new Request(SITE + path, { method, headers });
}

beforeAll(() => {
  previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = SITE;
});

beforeEach(async () => {
  await resetDb();
  cookieToken = undefined;
  const user = await db.adminUser.create({
    data: { username: "owner", passwordHash: await hashPassword("correct-horse-battery") },
  });
  userId = user.id;
});

afterAll(async () => {
  if (previousSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousSiteUrl;
  await db.$disconnect();
  await prisma.$disconnect();
});

async function validSession(): Promise<string> {
  const { token } = await createSession(db, userId, new Date());
  return token;
}

describe("adminHandler", () => {
  it("answers 401 without a session cookie and never calls the handler", async () => {
    const fn = vi.fn(async () => Response.json({ ok: true }));
    const res = await adminHandler(fn)(req("GET"));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "UNAUTHORIZED" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("answers 401 for an unknown session token", async () => {
    cookieToken = "x".repeat(43);
    const fn = vi.fn(async () => Response.json({ ok: true }));
    const res = await adminHandler(fn)(req("GET"));
    expect(res.status).toBe(401);
    expect(fn).not.toHaveBeenCalled();
  });

  it("answers 401 for an expired session", async () => {
    const { token } = await createSession(db, userId, new Date(Date.now() - 31 * 24 * 60 * 60 * 1000));
    cookieToken = token;
    const fn = vi.fn(async () => Response.json({ ok: true }));
    const res = await adminHandler(fn)(req("GET"));
    expect(res.status).toBe(401);
    expect(fn).not.toHaveBeenCalled();
  });

  it("answers 403 on a non-GET with a missing or foreign Origin, even with a valid session", async () => {
    cookieToken = await validSession();
    const fn = vi.fn(async () => Response.json({ ok: true }));
    const handler = adminHandler(fn);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      for (const headers of [{} as Record<string, string>, { origin: "https://evil.example" }, { origin: "http://bunbunnybakes.shop" }]) {
        const res = await handler(req(method, headers));
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "FORBIDDEN_ORIGIN" });
      }
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("checks the Origin before the session (bad Origin and no cookie is 403)", async () => {
    const res = await adminHandler(async () => Response.json({}))(req("POST", { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });

  it("runs the handler for a GET with a valid session, passing admin, now and params", async () => {
    cookieToken = await validSession();
    const before = Date.now();
    let seen: { username: string; now: Date; params: unknown } | undefined;
    const res = await adminHandler<{ id: string }>(async ({ admin, now, params }) => {
      seen = { username: admin.username, now, params };
      return Response.json({ hello: "world" });
    })(req("GET"), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
    expect(seen?.username).toBe("owner");
    expect(seen?.params).toEqual({ id: "abc" });
    expect(seen!.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(seen!.now.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("runs the handler for a same-origin POST with a valid session (params default to {})", async () => {
    cookieToken = await validSession();
    const res = await adminHandler(async ({ request, params }) =>
      Response.json({ method: request.method, params }),
    )(req("POST", { origin: SITE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: "POST", params: {} });
  });

  it("maps an AppError to its code, status and extra fields", async () => {
    cookieToken = await validSession();
    const res = await adminHandler(async () => {
      throw new AppError("OVER_LIMIT", { extra: { violations: [{ kind: "dough" }] } });
    })(req("GET"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "OVER_LIMIT",
      message: "这样会超过上限",
      violations: [{ kind: "dough" }],
    });
  });

  it("maps a ZodError to 422 VALIDATION with fields", async () => {
    cookieToken = await validSession();
    const res = await adminHandler(async () => {
      z.object({ qty: z.number() }).parse({ qty: "x" });
      return Response.json({});
    })(req("GET"));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("VALIDATION");
    expect(Object.keys(json.fields)).toEqual(["qty"]);
  });

  it("maps an unknown error to a bare 500 without details", async () => {
    cookieToken = await validSession();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await adminHandler(async () => {
        throw new Error("select * from secret_table failed at /srv/app/db.ts:12");
      })(req("GET"));
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: "INTERNAL", message: "提交失败，请稍后再试" });
      expect(text).not.toContain("secret_table");
      expect(text).not.toContain("db.ts");
      expect(text).not.toContain("stack");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("parseQuery", () => {
  const schema = z.object({
    status: z.union([z.string(), z.array(z.string())]).optional(),
    page: z.coerce.number().int().min(1).default(1),
  });

  it("parses single and repeated params", () => {
    const r = new Request(SITE + "/api/admin/x?status=NEW&status=CONFIRMED&page=2");
    expect(parseQuery(r, schema)).toEqual({ status: ["NEW", "CONFIRMED"], page: 2 });
    expect(parseQuery(new Request(SITE + "/api/admin/x"), schema)).toEqual({ page: 1 });
  });

  it("throws AppError VALIDATION with fields on a bad query", () => {
    try {
      parseQuery(new Request(SITE + "/api/admin/x?page=0"), schema);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("VALIDATION");
      expect(Object.keys((e as AppError).extra!.fields as object)).toEqual(["page"]);
    }
  });
});
