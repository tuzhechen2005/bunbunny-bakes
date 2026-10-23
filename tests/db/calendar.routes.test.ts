// Calendar route handlers: auth, Origin, validation, end-to-end JSON.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

import { GET } from "@/app/api/admin/calendar/route";
import { PUT } from "@/app/api/admin/dates/[date]/route";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { createDefaultProducts, createOpenDate, createOrder, createSettings, db, resetDb, type DefaultProductIds } from "./helpers";

const SITE = "https://bunbunnybakes.shop";
const DATE = "2026-10-30";
let previousSiteUrl: string | undefined;
let P: DefaultProductIds;

beforeAll(() => {
  previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = SITE;
});

beforeEach(async () => {
  await resetDb();
  await createSettings({ orderingEnabled: true });
  P = await createDefaultProducts();
  const user = await db.adminUser.create({
    data: { username: "owner", passwordHash: await hashPassword("correct-horse-battery") },
  });
  cookieToken = (await createSession(db, user.id, new Date())).token;
});

afterAll(async () => {
  if (previousSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousSiteUrl;
  await db.$disconnect();
  await prisma.$disconnect();
});

const getReq = (qs: string) => new Request(`${SITE}/api/admin/calendar?${qs}`);
const putReq = (body: unknown, headers: Record<string, string> = { origin: SITE }) =>
  new Request(`${SITE}/api/admin/dates/${DATE}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ date: DATE }) };
const okBody = { isOpen: true, doughLimitG: null, deliveryEnabled: true, deliveryLimit: null, productLimits: {}, note: null };

describe("calendar routes", () => {
  it("answer 401 without a session", async () => {
    cookieToken = undefined;
    expect((await GET(getReq(`from=${DATE}&to=${DATE}`))).status).toBe(401);
    expect((await PUT(putReq(okBody), ctx)).status).toBe(401);
  });

  it("PUT answers 403 on a bad Origin and writes nothing", async () => {
    const res = await PUT(putReq(okBody, { origin: "https://evil.example" }), ctx);
    expect(res.status).toBe(403);
    expect(await db.openDate.count()).toBe(0);
  });

  it("GET validates the range (missing, reversed, > 92 days)", async () => {
    for (const qs of ["", "from=2026-10-30", "from=2026-10-31&to=2026-10-30", "from=2026-01-01&to=2026-04-03", "from=2026-02-30&to=2026-03-01"]) {
      const res = await GET(getReq(qs));
      expect(res.status, qs).toBe(422);
      expect((await res.json()).error).toBe("VALIDATION");
    }
    // 92 days inclusive is fine.
    expect((await GET(getReq("from=2026-01-01&to=2026-04-02"))).status).toBe(200);
  });

  it("GET returns days; PUT then GET round-trips; 409 carries warnings", async () => {
    await createOpenDate(DATE);
    await createOrder({ date: DATE, items: [{ productId: P.redBean, qty: 2 }] });
    const res = await GET(getReq(`from=${DATE}&to=${DATE}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.days).toHaveLength(1);
    expect(json.days[0].usage.doughG).toBe(140);

    const conflict = await PUT(putReq({ ...okBody, isOpen: false }), ctx);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: "OVER_LIMIT", warnings: [{ kind: "HAS_ORDERS", count: 1 }] });

    const ok = await PUT(putReq({ ...okBody, isOpen: false, confirm: true }), ctx);
    expect(ok.status).toBe(200);
    expect((await ok.json()).isOpen).toBe(false);
  });

  it("PUT answers 422 for a non-INDEPENDENT product limit and for a bad date", async () => {
    const res = await PUT(putReq({ ...okBody, productLimits: { [P.redBean]: 3 } }), ctx);
    expect(res.status).toBe(422);
    const bad = await PUT(putReq(okBody), { params: Promise.resolve({ date: "nope" }) });
    expect(bad.status).toBe(422);
  });
});
