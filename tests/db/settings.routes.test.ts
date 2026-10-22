// GET/PUT /api/admin/settings and POST /api/admin/password, called as route handlers.

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

import { POST as passwordPOST } from "@/app/api/admin/password/route";
import { GET as settingsGET, PUT as settingsPUT } from "@/app/api/admin/settings/route";
import { copy } from "@/copy";
import { createSession, getSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { createSettings, db, resetDb } from "./helpers";

const SITE = "https://bunbunnybakes.com";
const PASSWORD = "correct-horse-battery";
let previousSiteUrl: string | undefined;
let userId: string;

const VALID = {
  cutoffTime: "20:00",
  defaultDoughLimitG: 1600,
  defaultDeliveryLimit: 8,
  deliveryFeeCents: 500,
  freeDeliveryMinCents: 2500,
  maxQtyPerItem: 8,
  ownerWechatId: "owner_wx",
  showWechatOnHome: false,
  pickupNote: "自提时间在下午 5 点以后，具体时间微信确认",
  bakingTextBread: "正在为你制作大面包！",
  bakingTextOther: "正在为你制作布蕾！",
};

function request(method: string, path: string, body?: unknown, headers: Record<string, string> = { origin: SITE }) {
  return new Request(SITE + path, {
    method,
    headers: { "content-type": "application/json", ...(method === "GET" ? {} : headers) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const put = (body: unknown, headers?: Record<string, string>) =>
  settingsPUT(request("PUT", "/api/admin/settings", body, headers));

beforeAll(() => {
  previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = SITE;
});

beforeEach(async () => {
  await resetDb();
  await createSettings({ ownerWechatId: VALID.ownerWechatId });
  const user = await db.adminUser.create({
    data: { username: "owner", passwordHash: await hashPassword(PASSWORD) },
  });
  userId = user.id;
  cookieToken = (await createSession(db, userId, new Date())).token;
});

afterAll(async () => {
  if (previousSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousSiteUrl;
  await db.$disconnect();
  await prisma.$disconnect();
});

describe("auth", () => {
  it("answers 401 without a session on every endpoint", async () => {
    cookieToken = undefined;
    expect((await settingsGET(request("GET", "/api/admin/settings"))).status).toBe(401);
    expect((await put(VALID)).status).toBe(401);
    expect(
      (await passwordPOST(request("POST", "/api/admin/password", { currentPassword: PASSWORD, newPassword: "x".repeat(12) }))).status,
    ).toBe(401);
  });

  it("answers 403 for a foreign Origin and changes nothing", async () => {
    const res = await put({ ...VALID, pickupNote: "hacked" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await db.setting.findUniqueOrThrow({ where: { id: 1 } })).pickupNote).not.toBe("hacked");
    const pw = await passwordPOST(
      request("POST", "/api/admin/password", { currentPassword: PASSWORD, newPassword: "another-long-pass" }, {}),
    );
    expect(pw.status).toBe(403);
  });
});

describe("GET /api/admin/settings", () => {
  it("returns every field except id, plus updatedAt", async () => {
    const res = await settingsGET(request("GET", "/api/admin/settings"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ...VALID, orderingEnabled: false });
    expect(json).not.toHaveProperty("id");
    expect(new Date(json.updatedAt).toString()).not.toBe("Invalid Date");
  });
});

describe("PUT /api/admin/settings validation", () => {
  async function expectInvalid(patch: Record<string, unknown>, field: string) {
    const res = await put({ ...VALID, ...patch });
    expect(res.status, JSON.stringify(patch)).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("VALIDATION");
    expect(Object.keys(json.fields)).toContain(field);
    expect(await db.auditLog.count()).toBe(0);
  }

  it.each([
    ["25:00", "cutoffTime"],
    ["8:00", "cutoffTime"],
    ["20:60", "cutoffTime"],
    ["", "cutoffTime"],
  ])("rejects cutoffTime %j", async (value, field) => {
    await expectInvalid({ cutoffTime: value }, field);
  });

  it.each(["01:00", "01:30", "02:00", "02:59"])(
    "rejects cutoffTime %s inside the DST window with the Chinese message",
    async (value) => {
      const res = await put({ ...VALID, cutoffTime: value });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.message).toBe("截止时刻不能设在凌晨 1 点到 3 点之间");
      expect(json.fields.cutoffTime).toBe(copy.admin.settings.cutoffTimeInvalid);
    },
  );

  it.each(["00:00", "00:59", "03:00", "20:00", "23:59"])("accepts cutoffTime %s", async (value) => {
    const res = await put({ ...VALID, cutoffTime: value });
    expect(res.status).toBe(200);
    expect((await res.json()).cutoffTime).toBe(value);
  });

  it.each([
    ["defaultDoughLimitG", -1],
    ["defaultDoughLimitG", 1.5],
    ["defaultDoughLimitG", "1600"],
    ["defaultDeliveryLimit", -1],
    ["defaultDeliveryLimit", 2.5],
    ["deliveryFeeCents", -1],
    ["deliveryFeeCents", 5.5],
    ["freeDeliveryMinCents", -100],
    ["freeDeliveryMinCents", null],
    ["maxQtyPerItem", 0],
    ["maxQtyPerItem", 100],
    ["maxQtyPerItem", 3.5],
    ["ownerWechatId", "x".repeat(41)],
    ["ownerWechatId", 5],
    ["showWechatOnHome", "yes"],
    ["pickupNote", "字".repeat(101)],
    ["bakingTextBread", ""],
    ["bakingTextBread", "   "],
    ["bakingTextBread", "字".repeat(41)],
    ["bakingTextOther", ""],
    ["bakingTextOther", "字".repeat(41)],
  ])("rejects %s = %j", async (field, value) => {
    await expectInvalid({ [field]: value }, field);
  });

  it("accepts the boundary values", async () => {
    const res = await put({
      ...VALID,
      defaultDoughLimitG: 0,
      defaultDeliveryLimit: 0,
      deliveryFeeCents: 0,
      freeDeliveryMinCents: 0,
      maxQtyPerItem: 99,
      ownerWechatId: "x".repeat(40),
      pickupNote: "字".repeat(100),
      bakingTextBread: "字",
      bakingTextOther: "字".repeat(40),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a missing field and a malformed body", async () => {
    const { pickupNote: _omit, ...rest } = VALID;
    void _omit;
    expect((await put(rest)).status).toBe(422);
    expect((await put("not json")).status).toBe(422);
  });

  it("trims the text fields", async () => {
    const res = await put({ ...VALID, ownerWechatId: "  wx_new  ", pickupNote: " hi " });
    const json = await res.json();
    expect(json.ownerWechatId).toBe("wx_new");
    expect(json.pickupNote).toBe("hi");
  });

  it("ignores orderingEnabled in the body", async () => {
    const res = await put({ ...VALID, orderingEnabled: true });
    expect(res.status).toBe(200);
    expect((await res.json()).orderingEnabled).toBe(false);
    expect((await db.setting.findUniqueOrThrow({ where: { id: 1 } })).orderingEnabled).toBe(false);
  });
});

describe("PUT /api/admin/settings writes", () => {
  it("saves, returns the new values and audits only the changed fields", async () => {
    const res = await put({ ...VALID, pickupNote: "新的自提说明", deliveryFeeCents: 600, showWechatOnHome: true });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ pickupNote: "新的自提说明", deliveryFeeCents: 600, showWechatOnHome: true });

    const row = await db.setting.findUniqueOrThrow({ where: { id: 1 } });
    expect(row.pickupNote).toBe("新的自提说明");
    expect(row.deliveryFeeCents).toBe(600);

    const logs = await db.auditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actor: "ADMIN",
      action: "settings.update",
      entityType: "Setting",
      entityId: "1",
      before: { pickupNote: VALID.pickupNote, deliveryFeeCents: 500, showWechatOnHome: false },
      after: { pickupNote: "新的自提说明", deliveryFeeCents: 600, showWechatOnHome: true },
    });
    expect(Object.keys(logs[0].after as object).sort()).toEqual(
      ["deliveryFeeCents", "pickupNote", "showWechatOnHome"],
    );
  });

  it("a save with no change writes no audit row", async () => {
    const res = await put(VALID);
    expect(res.status).toBe(200);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("leaves the ordering switch untouched when it is on", async () => {
    await db.setting.update({ where: { id: 1 }, data: { orderingEnabled: true } });
    const res = await put({ ...VALID, maxQtyPerItem: 5, orderingEnabled: false });
    expect((await res.json()).orderingEnabled).toBe(true);
    const log = await db.auditLog.findFirstOrThrow();
    expect(log.after).toEqual({ maxQtyPerItem: 5 });
  });
});

describe("POST /api/admin/password", () => {
  const change = (body: unknown) => passwordPOST(request("POST", "/api/admin/password", body));

  it("answers with the message for a wrong current password and changes nothing", async () => {
    const res = await change({ currentPassword: "wrong-password", newPassword: "brand-new-password" });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.message).toBe(copy.admin.auth.currentPasswordWrong);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("rejects a short new password with the message as is", async () => {
    const res = await change({ currentPassword: PASSWORD, newPassword: "short" });
    expect(res.status).toBe(422);
    expect((await res.json()).message).toBe(copy.admin.auth.passwordTooShort);
  });

  it("succeeds, keeps the current session, removes the others, and audits", async () => {
    const other = (await createSession(db, userId, new Date())).token;
    const res = await change({ currentPassword: PASSWORD, newPassword: "brand-new-password" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(await getSession(db, cookieToken, new Date())).not.toBeNull();
    expect(await getSession(db, other, new Date())).toBeNull();

    const log = await db.auditLog.findFirstOrThrow({ where: { action: "admin.password_change" } });
    expect(log.after).toEqual({ sessionsRevoked: 1 });
    expect(JSON.stringify(log)).not.toContain("brand-new-password");
  });
});
