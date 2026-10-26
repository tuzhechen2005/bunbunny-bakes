// Game-only pieces (D107): add / edit / limits / audit / authz, tier configs and snapshot validation.

import { readFileSync } from "node:fs";
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

import { DELETE as tierDELETE, PATCH as tierPATCH } from "@/app/api/admin/game/tiers/[id]/route";
import { DELETE as imgDELETE, POST as imgPOST } from "@/app/api/admin/game/tiers/[id]/image/route";
import { PUT as orderPUT } from "@/app/api/admin/game/tiers/order/route";
import { GET as tiersGET, POST as tiersPOST } from "@/app/api/admin/game/tiers/route";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { getImageStore } from "@/server/imageStore";
import { loadTierConfigs, MAX_PRODUCT_TIERS, tierDefsFromSnapshot } from "@/server/gameTiers";
import { createDefaultProducts, createSettings, db, resetDb, type DefaultProductIds } from "./helpers";

const SITE = "https://bunbunnybakes.shop";
let previousSiteUrl: string | undefined;
let P: DefaultProductIds;
const storedKeys = () => (getImageStore() as unknown as { keys(): string[] }).keys();
const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = { origin: SITE }) {
  return new Request(SITE + path, {
    method,
    headers: { "content-type": "application/json", ...(method === "GET" ? {} : headers) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const tiers = async () => (await tiersGET(req("GET", "/api/admin/game/tiers"))).json();
const audits = (prefix: string) =>
  db.auditLog.findMany({ where: { action: { startsWith: prefix } }, orderBy: { at: "asc" } });

beforeAll(async () => {
  previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = SITE;
});

beforeEach(async () => {
  await resetDb();
  await createSettings();
  P = await createDefaultProducts();
  const user = await db.adminUser.create({
    data: { username: "owner", passwordHash: await hashPassword("correct-horse-battery") },
  });
  cookieToken = (await createSession(db, user.id, new Date())).token;
  for (const key of storedKeys()) await getImageStore().delete(key);
});

afterAll(async () => {
  if (previousSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousSiteUrl;
  await db.$disconnect();
  await prisma.$disconnect();
});

const url = "/api/admin/game/tiers";
const post = (b: unknown, headers?: Record<string, string>) => tiersPOST(req("POST", url, b, headers));
const patch = (id: string, b: unknown) => tierPATCH(req("PATCH", "/x", b), idCtx(id));
type T = {
  id: string;
  isBig: boolean;
  gameOnly: boolean;
  name: string;
  fieldColor: string | null;
  color: { bg: string; ink: string };
  productId: string | null;
};
const nonBig = async () => ((await tiers()).tiers as T[]).filter((x) => !x.isBig);

describe("game-only pieces", () => {
  it("adds a piece with a name and colour; it is a game-only tier; audited", async () => {
    await post({});
    const res = await post({ name: "  泡芙 ", fieldColor: "#f0bf45" });
    expect(res.status).toBe(201);
    const list = await nonBig();
    expect(list).toHaveLength(5);
    expect(list.at(-1)).toMatchObject({ gameOnly: true, name: "泡芙", fieldColor: "#F0BF45", productId: null });
    expect(list.at(-1)!.color.bg).toBe("#F0BF45");
    expect(list[0].gameOnly).toBe(false);
    const a = await audits("game.tier.add");
    expect(a).toHaveLength(1);
    expect(a[0].after).toMatchObject({ name: "泡芙", fieldColor: "#F0BF45" });
  });

  it("works on the unsaved default view (saves the defaults first)", async () => {
    expect((await post({ name: "冰面包", fieldColor: "#CFDDEA" })).status).toBe(201);
    const v = await tiers();
    expect(v.configured).toBe(true);
    expect(v.tiers.filter((x: T) => !x.isBig)).toHaveLength(5);
  });

  it("validates the name and the colour", async () => {
    await post({});
    for (const bad of [
      { name: "", fieldColor: "#F0BF45" },
      { name: "   ", fieldColor: "#F0BF45" },
      { name: "一二三四五六七八九十一二三", fieldColor: "#F0BF45" },
      { name: "a\u0007b", fieldColor: "#F0BF45" },
      { name: "a‮b", fieldColor: "#F0BF45" },
      { name: "泡芙", fieldColor: "red" },
      { name: "泡芙", fieldColor: "#12345" },
      { name: "泡芙" },
      { fieldColor: "#F0BF45", name: 5 },
    ]) {
      const r = await post(bad);
      expect(r.status, JSON.stringify(bad)).toBe(422);
    }
    expect((await post({ name: "一二三四五六七八九十一二", fieldColor: "#F0BF45" })).status).toBe(201); // exactly 12
    expect(await nonBig()).toHaveLength(5);
  });

  it("max 8 counts product and game-only tiers together; the ninth is refused", async () => {
    await post({});
    for (let i = 0; i < 4; i++) expect((await post({ name: `片${i}`, fieldColor: "#DCC5BB" })).status).toBe(201);
    expect(await nonBig()).toHaveLength(MAX_PRODUCT_TIERS);
    const extra = await db.product.create({
      data: { name: "多一个", unitPriceCents: 300, capacityMode: "INDEPENDENT", dailyLimit: 5, batchYield: 1, description: "" },
    });
    for (const b of [{ name: "第九", fieldColor: "#DCC5BB" }, { productId: extra.id }]) {
      const r = await post(b);
      expect(r.status).toBe(422);
      expect((await r.json()).message).toBe("最多 8 档面包");
    }
  });

  it("at least 2 tiers stay (products and pieces together)", async () => {
    await post({});
    await post({ name: "泡芙", fieldColor: "#DCC5BB" });
    const list = await nonBig();
    for (const x of list.slice(0, 3)) expect((await tierDELETE(req("DELETE", "/x"), idCtx(x.id))).status).toBe(200);
    const left = await nonBig();
    expect(left).toHaveLength(2);
    expect((await tierDELETE(req("DELETE", "/x"), idCtx(left[0].id))).status).toBe(422);
  });

  it("image upload, delete and reorder work for a game-only tier", async () => {
    await post({});
    await post({ name: "泡芙", fieldColor: "#DCC5BB" });
    const piece = (await nonBig()).at(-1)!;
    const form = () => {
      const f = new FormData();
      f.append("file", new File([fixture("bun.png") as BlobPart], "t.png", { type: "image/png" }));
      return new Request(`${SITE}/x`, { method: "POST", headers: { origin: SITE }, body: f });
    };
    expect((await imgPOST(form(), idCtx(piece.id))).status).toBe(200);
    expect((await nonBig()).at(-1)).toMatchObject({ imageUrl: expect.stringMatching(/game\//) });
    expect(storedKeys()).toHaveLength(1);
    expect((await imgDELETE(req("DELETE", "/x"), idCtx(piece.id))).status).toBe(200);
    expect(storedKeys()).toHaveLength(0);
    const ids = (await nonBig()).map((x) => x.id);
    const moved = [ids.at(-1)!, ...ids.slice(0, -1)];
    expect((await orderPUT(req("PUT", "/api/admin/game/tiers/order", { ids: moved }))).status).toBe(200);
    expect((await nonBig())[0].id).toBe(piece.id);
  });
});

describe("tier look (PATCH name / colour)", () => {
  it("edits a piece's name and colour, and rejects clearing a piece's colour", async () => {
    await post({});
    await post({ name: "泡芙", fieldColor: "#DCC5BB" });
    const piece = (await nonBig()).at(-1)!;
    expect((await patch(piece.id, { name: "冰面包" })).status).toBe(200);
    expect((await patch(piece.id, { fieldColor: "#b05219" })).status).toBe(200);
    expect((await nonBig()).at(-1)).toMatchObject({ id: piece.id, name: "冰面包", fieldColor: "#B05219" });
    expect((await patch(piece.id, { fieldColor: null })).status).toBe(422);
    expect((await patch(piece.id, { name: "" })).status).toBe(422);
    expect((await patch(piece.id, {})).status).toBe(422);
    expect((await patch(piece.id, { fieldColor: "nope" })).status).toBe(422);
    expect((await patch("not-a-uuid", { name: "x" })).status).toBe(404);
    expect((await patch("00000000-0000-4000-8000-000000000000", { name: "x" })).status).toBe(404);
    const big = ((await tiers()).tiers as T[]).find((x) => x.isBig)!;
    expect((await patch(big.id, { name: "x" })).status).toBe(404);
  });

  it("a product tier may override its colour and reset it with null; audited", async () => {
    await db.product.update({ where: { id: P.redBean }, data: { fieldColor: "#DCC5BB" } });
    await post({});
    const first = (await nonBig())[0];
    expect(first.color.bg).toBe("#DCC5BB");
    expect((await patch(first.id, { fieldColor: "#5A3A2A" })).status).toBe(200);
    expect((await nonBig())[0]).toMatchObject({ fieldColor: "#5A3A2A", color: { bg: "#5A3A2A" } });
    expect((await patch(first.id, { fieldColor: null })).status).toBe(200);
    expect((await nonBig())[0]).toMatchObject({ fieldColor: null, color: { bg: "#DCC5BB" } });
    const a = await audits("game.tier.update");
    expect(a).toHaveLength(2);
    expect(a[1].before).toMatchObject({ fieldColor: "#5A3A2A" });
    expect(a[1].after).toMatchObject({ fieldColor: null });
  });

  it("the old { productId } PATCH still works", async () => {
    await post({});
    const extra = await db.product.create({
      data: { name: "替换", unitPriceCents: 300, capacityMode: "INDEPENDENT", dailyLimit: 5, batchYield: 1, description: "" },
    });
    expect((await patch((await nonBig())[0].id, { productId: extra.id })).status).toBe(200);
    expect((await nonBig())[0].name).toBe("替换");
  });
});

describe("authz", () => {
  it("401 without a session and 403 with a foreign origin for add and edit", async () => {
    await post({});
    const piece = { name: "泡芙", fieldColor: "#DCC5BB" };
    expect((await post(piece, { origin: "https://evil.example" })).status).toBe(403);
    const id = (await nonBig())[0].id;
    expect((await tierPATCH(req("PATCH", "/x", { name: "x" }, { origin: "https://evil.example" }), idCtx(id))).status).toBe(403);
    const saved = cookieToken;
    cookieToken = undefined;
    expect((await post(piece)).status).toBe(401);
    expect((await patch(id, { name: "x" })).status).toBe(401);
    cookieToken = saved;
    expect(await nonBig()).toHaveLength(4);
  });
});

describe("loadTierConfigs", () => {
  it("colour: tier override > product colour > preset cycle; name: tier name > product name; image: own > cover", async () => {
    await db.product.update({ where: { id: P.redBean }, data: { fieldColor: "#DCC5BB", imageUrl: "/api/images/cover.webp" } });
    await post({});
    const list = await nonBig();
    await patch(list[1].id, { fieldColor: "#5A3A2A", name: "改名" });
    await post({ name: "泡芙", fieldColor: "#CFDDEA" });
    const cfg = await loadTierConfigs(db);
    expect(cfg).toHaveLength(6);
    expect(cfg[0]).toMatchObject({ name: "奶酥红豆包", imageUrl: "/api/images/cover.webp", color: { bg: "#DCC5BB" } });
    expect(cfg[1]).toMatchObject({ name: "改名", color: { bg: "#5A3A2A" } });
    expect(cfg[4]).toMatchObject({ name: "泡芙", imageUrl: null, color: { bg: "#CFDDEA" } });
    expect(cfg[5]).toMatchObject({ id: "big", name: "兔的大面包" });
  });

  it("the default (fewer than 2 tiers saved) is the active products, up to 8, with names", async () => {
    for (let i = 0; i < 6; i++) {
      await db.product.create({
        data: { name: `p${i}`, unitPriceCents: 100, capacityMode: "INDEPENDENT", sortOrder: 10 + i, dailyLimit: 5, batchYield: 1, description: "" },
      });
    }
    const cfg = await loadTierConfigs(db);
    expect(cfg).toHaveLength(9);
    expect(cfg[0].name).toBe("奶酥红豆包");
    expect(cfg.at(-1)!.id).toBe("big");
  });

  it("nine tiers (8 + big) are accepted by the snapshot check, ten rejected", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, radius: 0.1, points: i }));
    expect(tierDefsFromSnapshot(mk(9))).toHaveLength(9);
    expect(() => tierDefsFromSnapshot(mk(10))).toThrow();
    expect(() => tierDefsFromSnapshot(mk(1))).toThrow();
  });

  it("deleting a product leaves a usable game-only tier that needs a name", async () => {
    await post({});
    const list = await nonBig();
    await db.product.delete({ where: { id: P.redBean } });
    const after = await nonBig();
    expect(after).toHaveLength(list.length);
    expect(after[0]).toMatchObject({ productId: null, gameOnly: true, name: "" });
    const cfg = await loadTierConfigs(db);
    expect(cfg[0]).toMatchObject({ id: list[0].id, name: "" });
    expect(cfg[0].color.bg).toMatch(/^#[0-9A-F]{6}$/i);
    // A name-only edit keeps the NULL colour (the preset cycle); then a colour can be set.
    expect((await patch(list[0].id, { name: "救回来" })).status).toBe(200);
    expect((await nonBig())[0]).toMatchObject({ name: "救回来", gameOnly: true });
    expect((await patch(list[0].id, { fieldColor: "#F0BF45" })).status).toBe(200);
  });
});
