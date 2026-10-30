import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let cookieToken: string | undefined;
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => cookieToken ? { value: cookieToken } : undefined }) }));

import { GET as hubGET } from "@/app/api/game/hub/route";
import { GET as prizeGET, PATCH as prizePATCH } from "@/app/api/admin/game/prize/route";
import { createSession, hashPassword } from "@/server/auth";
import * as audit from "@/server/audit";
import { prisma } from "@/server/db";
import { getPrizeWeek, overridePrizeGame } from "@/server/gamePrize";
import { getGameHub } from "@/server/gameHub";
import { db, resetDb } from "./helpers";

const NOW = new Date("2026-10-28T17:00:00Z");
const WEEK = "2026-10-26";
const SITE = "https://bunbunnybakes.shop";
const request = (method: string, body?: unknown, origin = SITE) => new Request(`${SITE}/api/admin/game/prize`, {
  method, headers: { origin, "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.stubEnv("SITE_URL", SITE);
  cookieToken = undefined;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { await db.$disconnect(); await prisma.$disconnect(); });

describe("weekly prize selection", () => {
  it("creates one cryptographic pick under concurrency and keeps it on repeated reads", async () => {
    const rows = await Promise.all(Array.from({ length: 12 }, () => getPrizeWeek(db, NOW)));
    expect(["BIG", "TU"]).toContain(rows[0].game);
    for (const row of rows) expect(row).toEqual(rows[0]);
    expect(rows[0]).toMatchObject({ weekKey: WEEK, chosenBy: "RANDOM", createdAt: NOW });
    expect(await db.gamePrizeWeek.count()).toBe(1);
  });

  it("never repeats last week's choice, including OWNER choices and the DST reset", async () => {
    await overridePrizeGame(db, "TU", NOW);
    const before = await getPrizeWeek(db, new Date("2026-11-02T05:59:59.999Z"));
    expect(before).toMatchObject({ weekKey: WEEK, game: "TU", chosenBy: "OWNER" });
    const after = await getPrizeWeek(db, new Date("2026-11-02T06:00:00Z"));
    expect(after).toMatchObject({ weekKey: "2026-11-02", game: "BIG", chosenBy: "RANDOM" });
    expect((await getPrizeWeek(db, new Date("2026-11-09T06:00:00Z"))).game).toBe("TU");
  });

  it("backfills a closed week without repeating an already selected following week", async () => {
    await overridePrizeGame(db, "TU", NOW);
    expect((await getPrizeWeek(db, new Date("2026-10-21T17:00:00Z"))).game).toBe("BIG");
  });

  it("an owner override survives concurrent lazy picks and writes before/after audit atomically", async () => {
    const before = await getPrizeWeek(db, NOW);
    await Promise.all([getPrizeWeek(db, NOW), overridePrizeGame(db, "TU", NOW), getPrizeWeek(db, NOW)]);
    expect(await getPrizeWeek(db, NOW)).toMatchObject({ game: "TU", chosenBy: "OWNER" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "game.prize" } });
    expect(audit).toMatchObject({ actor: "ADMIN", entityType: "GamePrizeWeek", entityId: WEEK,
      before: { game: before.game, chosenBy: "RANDOM" }, after: { game: "TU", chosenBy: "OWNER" } });
    await overridePrizeGame(db, "TU", NOW);
    expect(await db.auditLog.count()).toBe(1);
    await expect(overridePrizeGame(db, "M3", NOW)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.gamePrizeWeek.count()).toBe(1);
  });

  it("rolls back an override when its audit cannot be written", async () => {
    const before = await getPrizeWeek(db, NOW);
    vi.spyOn(audit, "writeAudit").mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(overridePrizeGame(db, "TU", NOW)).rejects.toThrow("audit unavailable");
    expect(await getPrizeWeek(db, NOW)).toEqual(before);
    expect(await db.auditLog.count()).toBe(0);
  });

  it("allows the owner to create the choice before any visitor and preserves createdAt", async () => {
    await overridePrizeGame(db, "TU", NOW);
    const later = new Date(NOW.getTime() + 60_000);
    await overridePrizeGame(db, "BIG", later);
    expect(await getPrizeWeek(db, later)).toMatchObject({ game: "BIG", chosenBy: "OWNER", createdAt: NOW });
    const rows = await db.auditLog.findMany({ orderBy: { at: "asc" } });
    expect(rows[0].before).toBeNull();
    expect(rows[1]).toMatchObject({ before: { game: "TU", chosenBy: "OWNER" }, after: { game: "BIG", chosenBy: "OWNER" } });
  });
});

describe("hub and admin API", () => {
  it("returns only game metadata and eligible weekly scores, including zero and null", async () => {
    await overridePrizeGame(db, "TU", NOW);
    for (const [wechatId, game, score, hidden, weekKey, finishedAt] of [
      ["private_zero", "BIG", 0, false, WEEK, NOW],
      ["private_hidden", "BIG", 999, true, WEEK, NOW],
      ["private_banned", "TU", 999, false, WEEK, NOW],
      ["private_old", "TU", 999, false, "2026-10-19", NOW],
      ["private_unfinished", "TU", 999, false, WEEK, null],
    ] as const) await db.gameRun.create({ data: { seed: "s", nickname: wechatId, wechatId, game, score, hidden, weekKey, finishedAt, tiersSnapshot: [] } });
    await db.gameBan.create({ data: { wechatId: "PRIVATE_BANNED" } });
    const response = await hubGET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ liveScores: true, week: { start: WEEK, end: "2026-11-01" }, prizeGame: "TU", games: [
      { kind: "BIG", name: "消除大面包", href: "/game", weekBest: 0, live: false },
      { kind: "TU", name: "兔了个兔", href: "/game/tu", weekBest: null, live: false },
      { kind: "M3", name: "兔兔三连烤", href: "/game/m3", weekBest: null, live: false },
    ] });
    expect(JSON.stringify(body)).not.toContain("private_");
    expect((await getGameHub(db, new Date("2026-11-02T06:00:00Z"))).games.every((g) => g.weekBest === null)).toBe(true);
  });

  it("requires a session and same origin, validates the enabled kind, and changes only the current week", async () => {
    expect((await prizeGET(request("GET"))).status).toBe(401);
    expect((await prizePATCH(request("PATCH", { game: "TU" }))).status).toBe(401);
    const user = await db.adminUser.create({ data: { username: "owner", passwordHash: await hashPassword("correct-horse-battery") } });
    cookieToken = (await createSession(db, user.id, NOW)).token;
    expect((await prizePATCH(request("PATCH", { game: "TU" }, "https://evil.example"))).status).toBe(403);
    for (const body of [{ game: "M3" }, { game: "TU", week: "2026-10-19" }, null]) {
      expect((await prizePATCH(request("PATCH", body))).status).toBe(422);
    }
    expect((await prizeGET(request("GET"))).status).toBe(200);
    const response = await prizePATCH(request("PATCH", { game: "TU" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ weekKey: WEEK, game: "TU", chosenBy: "OWNER" });
    expect((await getGameHub(db, NOW)).prizeGame).toBe("TU");
    expect(await db.auditLog.count({ where: { action: "game.prize" } })).toBe(1);
  });
});
