// /api/admin/game/**: auth + origin, tier config (defaults, add/remove/min 2/reorder/image),
// leaderboard moderation (hide, ban, ranks, eligibility), weekly award, AuditLog for every write.
// The game tables come from tests/db/gameTables.ts until L1's migration lands.

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

import { PATCH as awardPATCH } from "@/app/api/admin/game/award/route";
import { POST as banPOST } from "@/app/api/admin/game/bans/route";
import { DELETE as banDELETE } from "@/app/api/admin/game/bans/[wechatId]/route";
import { GET as boardGET } from "@/app/api/admin/game/leaderboard/route";
import { PATCH as runPATCH } from "@/app/api/admin/game/runs/[id]/route";
import { DELETE as tierDELETE, PATCH as tierPATCH } from "@/app/api/admin/game/tiers/[id]/route";
import { DELETE as imgDELETE, POST as imgPOST } from "@/app/api/admin/game/tiers/[id]/image/route";
import { PUT as orderPUT } from "@/app/api/admin/game/tiers/order/route";
import { GET as tiersGET, POST as tiersPOST } from "@/app/api/admin/game/tiers/route";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { weekKeyOf } from "@/server/gameAdmin";
import { getImageStore } from "@/server/imageStore";
import { GAME_DDL } from "./gameTables";
import { createDefaultProducts, createOpenDate, createOrder, createSettings, db, resetDb, type DefaultProductIds } from "./helpers";

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
const board = async (week?: string) =>
  (await boardGET(req("GET", `/api/admin/game/leaderboard${week ? `?week=${week}` : ""}`))).json();
const audits = (prefix: string) =>
  db.auditLog.findMany({ where: { action: { startsWith: prefix } }, orderBy: { at: "asc" } });

beforeAll(async () => {
  previousSiteUrl = process.env.SITE_URL;
  process.env.SITE_URL = SITE;
  for (const sql of GAME_DDL) await db.$executeRawUnsafe(sql);
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

const THIS_WEEK = weekKeyOf(new Date());

async function run(wechatId: string, nickname: string, score: number, opts: { hidden?: boolean; minutesAgo?: number; week?: string } = {}) {
  const finished = new Date(Date.now() - (opts.minutesAgo ?? 0) * 60_000).toISOString();
  const rows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO "GameRun" ("wechatId","nickname","score","weekKey","finishedAt","hidden")
    VALUES (${wechatId}, ${nickname}, ${score}, ${opts.week ?? THIS_WEEK}, ${finished}::timestamptz, ${opts.hidden ?? false})
    RETURNING "id"::text AS id`;
  return rows[0].id;
}

describe("auth", () => {
  it("401 without a session, 403 with a foreign Origin", async () => {
    cookieToken = undefined;
    expect((await tiersGET(req("GET", "/api/admin/game/tiers"))).status).toBe(401);
    expect((await boardGET(req("GET", "/api/admin/game/leaderboard"))).status).toBe(401);
    cookieToken = "x";
    const forged = { origin: "https://evil.example" };
    expect((await banPOST(req("POST", "/api/admin/game/bans", { wechatId: "a" }, forged))).status).toBe(403);
    expect((await tiersPOST(req("POST", "/api/admin/game/tiers", { productId: P.brulee }, forged))).status).toBe(403);
  });
});

describe("tiers", () => {
  it("shows the defaults (active products) until the first save, then stores them", async () => {
    let v = await tiers();
    expect(v.configured).toBe(false);
    expect(v.tiers.filter((x: { isBig: boolean }) => !x.isBig)).toHaveLength(4);
    expect(v.tiers.at(-1).isBig).toBe(true);
    expect((await tiersPOST(req("POST", "/api/admin/game/tiers", {}))).status).toBe(201);
    v = await tiers();
    expect(v.configured).toBe(true);
    expect(v.tiers.map((x: { productName: string | null }) => x.productName)).toEqual([
      "奶酥红豆包", "岩烧乳酪包", "奶酪角", "焦糖布蕾", null,
    ]);
  });

  it("add is limited to active, unused products; remove keeps at least 2; reorder; all audited", async () => {
    await tiersPOST(req("POST", "/api/admin/game/tiers", {}));
    const extra = await db.product.create({ data: { name: "新面包", unitPriceCents: 300, capacityMode: "INDEPENDENT", dailyLimit: 5, batchYield: 1, description: "" } });
    const paused = await db.product.create({ data: { name: "停售", unitPriceCents: 300, capacityMode: "INDEPENDENT", dailyLimit: 5, batchYield: 1, status: "PAUSED", description: "" } });
    expect((await tiersPOST(req("POST", "/api/admin/game/tiers", { productId: paused.id }))).status).toBe(422);
    expect((await tiersPOST(req("POST", "/api/admin/game/tiers", { productId: "nope" }))).status).toBe(422);
    expect((await tiersPOST(req("POST", "/api/admin/game/tiers", { productId: extra.id }))).status).toBe(201);
    let v = await tiers();
    const ids = v.tiers.filter((x: { isBig: boolean }) => !x.isBig).map((x: { id: string }) => x.id);
    expect(ids).toHaveLength(5);

    const reversed = [...ids].reverse();
    expect((await orderPUT(req("PUT", "/api/admin/game/tiers/order", { ids: reversed }))).status).toBe(200);
    v = await tiers();
    expect(v.tiers.filter((x: { isBig: boolean }) => !x.isBig).map((x: { id: string }) => x.id)).toEqual(reversed);
    expect(v.tiers.at(-1).isBig).toBe(true);
    expect((await orderPUT(req("PUT", "/api/admin/game/tiers/order", { ids: ids.slice(1) }))).status).toBe(422);

    // swap a product
    expect((await tierPATCH(req("PATCH", "/x", { productId: P.brulee }), idCtx(reversed[0]))).status).toBe(200);

    // remove down to 2
    for (const id of reversed.slice(0, 3)) expect((await tierDELETE(req("DELETE", "/x"), idCtx(id))).status).toBe(200);
    const last = reversed[3];
    const res = await tierDELETE(req("DELETE", "/x"), idCtx(last));
    expect(res.status).toBe(422);
    expect((await res.json()).message).toBe("至少要保留 2 种面包");
    expect((await tiers()).tiers.filter((x: { isBig: boolean }) => !x.isBig)).toHaveLength(2);

    for (const a of ["game.tier.add", "game.tier.order", "game.tier.update", "game.tier.remove"]) {
      expect((await audits(a)).length, a).toBeGreaterThan(0);
    }
    expect((await audits("game.tier.remove")).length).toBe(3);
  });

  it("uploads, replaces and deletes a tier image under the game/ prefix (big tier too)", async () => {
    await tiersPOST(req("POST", "/api/admin/game/tiers", {}));
    const v = await tiers();
    const first = v.tiers[0].id as string;
    const form = () => {
      const f = new FormData();
      f.append("file", new File([fixture("bun.png") as BlobPart], "t.png", { type: "image/png" }));
      return new Request(`${SITE}/api/admin/game/tiers/${first}/image`, { method: "POST", headers: { origin: SITE }, body: f });
    };
    expect((await imgPOST(form(), idCtx(first))).status).toBe(200);
    let url = (await tiers()).tiers[0].imageUrl as string;
    expect(url).toMatch(/^\/api\/images\/game\/[0-9a-f]{32}\.png$/);
    expect(storedKeys()).toHaveLength(1);
    await imgPOST(form(), idCtx(first));
    expect(storedKeys()).toHaveLength(1); // old blob removed
    url = (await tiers()).tiers[0].imageUrl;
    expect(storedKeys()[0]).toBe(url.replace("/api/images/", ""));

    // the public route serves game/ keys
    const { GET } = await import("@/app/api/images/[...key]/route");
    const pub = await GET(new Request(SITE + url), { params: Promise.resolve({ key: url.replace("/api/images/", "").split("/") }) });
    expect(pub.status).toBe(200);

    expect((await imgDELETE(req("DELETE", "/x"), idCtx(first))).status).toBe(200);
    expect((await tiers()).tiers[0].imageUrl).toBeNull();
    expect(storedKeys()).toHaveLength(0);

    const bad = new FormData();
    bad.append("file", new File(["not an image"], "t.png", { type: "image/png" }));
    const res = await imgPOST(new Request(`${SITE}/x`, { method: "POST", headers: { origin: SITE }, body: bad }), idCtx(first));
    expect(res.status).toBe(422);

    const big = (await tiers()).tiers.at(-1).id;
    expect((await imgPOST(form(), idCtx(big))).status).toBe(200);
    expect((await tiers()).tiers.at(-1).imageUrl).toMatch(/game\//);
    expect((await audits("game.tier.image")).length).toBe(4);
  });

  it("an image upload on the unsaved default view saves the defaults first (big tier)", async () => {
    const f = new FormData();
    f.append("file", new File([fixture("bun.png") as BlobPart], "t.png", { type: "image/png" }));
    const res = await imgPOST(new Request(`${SITE}/x`, { method: "POST", headers: { origin: SITE }, body: f }), idCtx("big"));
    expect(res.status).toBe(200);
    const v = await tiers();
    expect(v.configured).toBe(true);
    expect(v.tiers.at(-1).imageUrl).toMatch(/game\//);
  });
});

describe("leaderboard", () => {
  it("ranks best-per-wechat by score then earliest, with full ids and the order badge", async () => {
    await createOpenDate("2026-12-01");
    await createOrder({ date: "2026-12-01", items: [{ productId: P.redBean, qty: 1 }], wechatId: "Alice_W", status: "COMPLETED" });
    await createOrder({ date: "2026-12-01", items: [{ productId: P.redBean, qty: 1 }], wechatId: "bob_w", status: "CANCELLED" });
    await run("alice_w", "艾", 300, { minutesAgo: 5 });
    await run("alice_w", "艾", 900, { minutesAgo: 4 });
    await run("bob_w", "鲍", 900, { minutesAgo: 10 });
    await run("cara_w", "卡", 100);
    const b = await board();
    expect(b.week).toBe(THIS_WEEK);
    const ranked = b.rows.filter((r: { rank: number | null }) => r.rank !== null);
    expect(ranked.map((r: { wechatId: string }) => r.wechatId)).toEqual(["bob_w", "alice_w", "cara_w"]);
    expect(b.rows.find((r: { wechatId: string; rank: null | number }) => r.wechatId === "alice_w" && r.rank === null).score).toBe(300);
    expect(b.rows.find((r: { wechatId: string }) => r.wechatId === "alice_w").ordered).toBe(true);
    expect(b.rows.find((r: { wechatId: string }) => r.wechatId === "bob_w").ordered).toBe(false); // cancelled only
    expect(b.rows.find((r: { wechatId: string }) => r.wechatId === "cara_w").ordered).toBe(false);
    expect(b.winner.wechatId).toBe("bob_w");
    expect(b.winner.stored).toBe(false);
    expect(b.weeks).toContain(THIS_WEEK);
  });

  it("rejects a bad week parameter and shows an empty past week", async () => {
    expect((await boardGET(req("GET", "/api/admin/game/leaderboard?week=2026-12-02"))).status).toBe(422); // not a Monday
    const b = await board("2026-11-02");
    expect(b.rows).toEqual([]);
    expect(b.winner).toBeNull();
  });

  it("hide / unhide moves the winner and is audited once per change", async () => {
    const top = await run("top_w", "顶", 500);
    await run("second_w", "二", 400);
    expect((await runPATCH(req("PATCH", "/x", { hidden: true }), idCtx(top))).status).toBe(200);
    await runPATCH(req("PATCH", "/x", { hidden: true }), idCtx(top)); // no-op, no extra audit
    let b = await board();
    expect(b.winner.wechatId).toBe("second_w");
    expect(b.rows.find((r: { id: string }) => r.id === top).hidden).toBe(true);
    await runPATCH(req("PATCH", "/x", { hidden: false }), idCtx(top));
    b = await board();
    expect(b.winner.wechatId).toBe("top_w");
    expect((await audits("game.run.hide")).length).toBe(1);
    expect((await audits("game.run.unhide")).length).toBe(1);
    expect((await runPATCH(req("PATCH", "/x", { hidden: true }), idCtx("11111111-1111-4111-8111-111111111111"))).status).toBe(404);
  });

  it("ban / unban is case-insensitive, drops the player from the ranking, and is audited", async () => {
    await run("Cheater_W", "骗", 999);
    await run("fair_w", "公", 10);
    expect((await banPOST(req("POST", "/api/admin/game/bans", { wechatId: "cheater_w", reason: "脚本" }))).status).toBe(201);
    await banPOST(req("POST", "/api/admin/game/bans", { wechatId: "CHEATER_W", reason: "脚本 2" })); // same id: updates, no duplicate
    let b = await board();
    expect(b.bans).toHaveLength(1);
    expect(b.bans[0].reason).toBe("脚本 2");
    expect(b.winner.wechatId).toBe("fair_w");
    expect(b.rows.find((r: { wechatId: string }) => r.wechatId === "Cheater_W")).toMatchObject({ banned: true, rank: null });
    expect((await banDELETE(req("DELETE", "/x"), { params: Promise.resolve({ wechatId: "cheater_w" }) })).status).toBe(200);
    expect((await banDELETE(req("DELETE", "/x"), { params: Promise.resolve({ wechatId: "cheater_w" }) })).status).toBe(404);
    b = await board();
    expect(b.bans).toEqual([]);
    expect(b.winner.wechatId).toBe("Cheater_W");
    expect((await audits("game.ban")).length).toBe(2);
    expect((await audits("game.unban")).length).toBe(1);
    expect((await banPOST(req("POST", "/api/admin/game/bans", { wechatId: "  " }))).status).toBe(422);
  });

  it("award: created for the current leader on first toggle, then contacted / redeemed / note", async () => {
    expect((await awardPATCH(req("PATCH", "/x", { week: THIS_WEEK, contacted: true }))).status).toBe(422); // nobody yet
    const winnerRun = await run("win_w", "赢", 700);
    expect((await awardPATCH(req("PATCH", "/x", { week: THIS_WEEK, contacted: true }))).status).toBe(200);
    await run("later_w", "后", 800); // a higher score later does not steal a recorded award
    expect((await awardPATCH(req("PATCH", "/x", { week: THIS_WEEK, redeemed: true, note: "  面包券 " }))).status).toBe(200);
    let b = await board();
    expect(b.winner).toMatchObject({ stored: true, runId: winnerRun, wechatId: "win_w", note: "面包券" });
    expect(b.winner.contactedAt).not.toBeNull();
    expect(b.winner.redeemedAt).not.toBeNull();
    await awardPATCH(req("PATCH", "/x", { week: THIS_WEEK, contacted: false }));
    b = await board();
    expect(b.winner.contactedAt).toBeNull();
    expect((await audits("game.award")).length).toBe(3);
    expect((await awardPATCH(req("PATCH", "/x", { week: "bad" }))).status).toBe(422);
  });
});
