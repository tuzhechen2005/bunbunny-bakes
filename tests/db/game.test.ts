import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
import { GET as leaderboardGET } from "@/app/api/game/leaderboard/route";
import { POST as finishPOST } from "@/app/api/game/finish/route";
import { POST as startPOST } from "@/app/api/game/start/route";
import { replay } from "@/lib/game";
import { prisma } from "@/server/db";
import {
  FINISH_LIMIT_PER_HOUR,
  finishRun,
  getLeaderboard,
  hasOrdered,
  isBanned,
  START_LIMIT_PER_HOUR,
  startRun,
} from "@/server/game";
import { runExpiresAt } from "@/server/gameWeek";
import { cleanup } from "@/server/maintenance";
import { botRun } from "../support/gameBot";
import { getRequest, jsonRequest, NOW } from "./api.helpers";
import { createDefaultProducts, createOpenDate, createOrder, createSettings, db, resetDb } from "./helpers";

process.env.IP_HASH_SECRET = "test-secret";

const IP = "iphash-a";
// A Wednesday in the week of Monday 2026-10-19 (Chicago).
const T = NOW;
const WEEK = "2026-10-19";
// Finishing needs real time to have passed since start (a client cannot simulate faster than real time).
const LATER = new Date(T.getTime() + 60 * 60_000);

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
});

async function start(wechatId = "wx_alice", nickname = "Alice", ip = IP, now = T) {
  return startRun(db, { wechatId, nickname }, ip, now);
}

/** Plays a bot game on the run's own seed and tiers; returns the log and the score the server must agree on. */
function play(run: Awaited<ReturnType<typeof start>>, drops = 20) {
  const bot = botRun(run.seed, run.tiers, drops);
  return { drops: bot.log, score: bot.score };
}

async function insertRun(over: {
  wechatId: string;
  nickname?: string;
  score: number;
  finishedAt?: Date;
  weekKey?: string;
  hidden?: boolean;
}) {
  return db.gameRun.create({
    data: {
      seed: "s",
      wechatId: over.wechatId,
      nickname: over.nickname ?? over.wechatId,
      tiersSnapshot: [],
      startedAt: over.finishedAt ?? T,
      finishedAt: over.finishedAt ?? T,
      score: over.score,
      weekKey: over.weekKey ?? WEEK,
      hidden: over.hidden ?? false,
    },
  });
}

describe("start", () => {
  it("returns the contract shape with default tiers from the active products in menu order", async () => {
    const ids = await createDefaultProducts();
    await db.product.update({ where: { id: ids.redBean }, data: { imageUrl: "/api/images/a.webp" } });
    await db.product.update({ where: { id: ids.rockCheese }, data: { status: "PAUSED" } });
    const r = await start();
    expect(Object.keys(r).sort()).toEqual(["expiresAt", "runId", "seed", "tiers"]);
    expect(r.seed).toMatch(/^[0-9a-f]{32}$/);
    // The weekly reset after the start: Monday 2026-10-26 00:00 CDT.
    expect(r.expiresAt).toBe("2026-10-26T05:00:00.000Z");
    // 3 active products + big.
    expect(r.tiers.map((t) => t.id)).toEqual([ids.redBean, ids.cheeseHorn, ids.brulee, "big"]);
    expect(r.tiers[0].imageUrl).toBe("/api/images/a.webp");
    expect(r.tiers[3].imageUrl).toBe("/brand/logo.webp");
    for (const t of r.tiers) {
      expect(Object.keys(t).sort()).toEqual(["color", "id", "imageUrl", "name", "points", "radius"]);
      expect(t.color.bg).toMatch(/^#[0-9A-F]{6}$/i);
      expect(t.color.ink).toMatch(/^#[0-9A-F]{6}$/i);
    }
    const radii = r.tiers.map((t) => t.radius);
    expect(radii[0]).toBe(0.071);
    expect(radii[3]).toBe(0.268);
    expect([...radii].sort((a, b) => a - b)).toEqual(radii);
    // Triangular numbers x 10 by tier index.
    expect(r.tiers.map((t) => t.points)).toEqual([0, 10, 30, 60]);
  });

  it("uses at most 8 products", async () => {
    await createDefaultProducts();
    await db.product.create({
      data: { name: "p5", unitPriceCents: 100, capacityMode: "INDEPENDENT", sortOrder: 9, dailyLimit: 5 },
    });
    await db.product.create({
      data: { name: "p6", unitPriceCents: 100, capacityMode: "INDEPENDENT", sortOrder: 10, dailyLimit: 5 },
    });
    expect((await start()).tiers).toHaveLength(7); // 6 products + the big one
  });

  it("owner-configured tiers win over the default, in sortOrder, with their own image", async () => {
    const ids = await createDefaultProducts();
    await db.gameTier.createMany({
      data: [
        { productId: ids.brulee, sortOrder: 1, imageUrl: "/api/images/b.webp" },
        { productId: ids.redBean, sortOrder: 0, imageUrl: null },
        { sortOrder: 99, isBig: true, imageUrl: "/api/images/big.webp" },
      ],
    });
    await db.product.update({ where: { id: ids.redBean }, data: { imageUrl: "/api/images/cover.webp" } });
    const r = await start();
    expect(r.tiers).toHaveLength(3);
    expect(r.tiers[0].imageUrl).toBe("/api/images/cover.webp"); // falls back to the product cover
    expect(r.tiers[1].imageUrl).toBe("/api/images/b.webp");
    expect(r.tiers[2]).toMatchObject({ id: "big", imageUrl: "/api/images/big.webp" });
  });

  it("is playable with no products at all", async () => {
    const r = await start();
    expect(r.tiers.map((t) => t.id)).toEqual(["t0", "t1", "big"]);
  });

  it("validates the wechat id and nickname", async () => {
    const bad = async (wechatId: unknown, nickname: unknown) =>
      expect(startRun(db, { wechatId, nickname }, IP, T)).rejects.toMatchObject({ code: "VALIDATION" });
    await bad("", "Al");
    await bad("   ", "Al");
    await bad("x".repeat(41), "Al");
    await bad("wx", "");
    await bad("wx", "   ");
    await bad("wx", "12345678901"); // 11 chars
    await bad("wx", "ab\ncd");
    await bad("wx", "a\u0000b");
    await bad("wx", "a‮b");
    await bad("wx", 5);
    await bad(undefined, "Al");
    await expect(startRun(db, null, IP, T)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("accepts 10 characters (counted as code points), trims, keeps emoji", async () => {
    const r = await start("  wx_t  ", "  🐰🐰🐰🐰🐰🐰🐰🐰🐰🐰  ");
    const row = await db.gameRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(row.wechatId).toBe("wx_t");
    expect([...row.nickname]).toHaveLength(10);
  });

  it("refuses banned wechat ids (case-insensitive) with a friendly message and stores nothing", async () => {
    await db.gameBan.create({ data: { wechatId: "BadGuy", reason: "cheat" } });
    await expect(start("badguy", "x")).rejects.toMatchObject({
      code: "VALIDATION",
      message: expect.stringContaining("不能参加游戏"),
    });
    expect(await db.gameRun.count()).toBe(0);
  });

  it("stores the snapshot, seed and ip hash only (no raw ip)", async () => {
    await createDefaultProducts();
    const r = await start();
    const row = await db.gameRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(row.ipHash).toBe(IP);
    expect(row.finishedAt).toBeNull();
    expect(row.tiersSnapshot).toEqual(JSON.parse(JSON.stringify(r.tiers)));
  });

  it("two runs get different seeds", async () => {
    const a = await start();
    const b = await start();
    expect(a.seed).not.toBe(b.seed);
  });

  it(`allows ${START_LIMIT_PER_HOUR} starts per hour per IP, the next is RATE_LIMITED, other IPs and later hours are fine`, async () => {
    await db.rateLimitHit.createMany({
      data: Array.from({ length: START_LIMIT_PER_HOUR }, () => ({ key: `game_start_ip:${IP}`, at: T })),
    });
    await expect(start()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(start("wx", "A", "other-ip")).resolves.toBeDefined();
    await expect(start("wx", "A", IP, new Date(T.getTime() + 61 * 60_000))).resolves.toBeDefined();
  });
});

describe("finish", () => {
  it("verifies the drop log by replay and stores the verified score, week and time", async () => {
    await createDefaultProducts();
    const run = await start();
    const { drops, score } = play(run);
    const later = new Date(T.getTime() + 5 * 60_000);
    const res = await finishRun(db, { runId: run.runId, drops }, IP, later);
    expect(res).toEqual({
      score,
      best: score,
      rank: 1,
      week: { start: WEEK, end: "2026-10-25" },
      personalBest: score,
      newRecord: true,
    });
    const row = await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } });
    expect(row).toMatchObject({ score, weekKey: WEEK, hidden: false });
    expect(row.finishedAt?.getTime()).toBe(later.getTime());
  });

  it("never trusts a client-sent score", async () => {
    const run = await start();
    const { drops, score } = play(run, 10);
    const res = await finishRun(db, { runId: run.runId, drops, score: 999999 }, IP, LATER);
    expect(res.score).toBe(score);
  });

  it("is idempotent: repeating returns the same result and does not rewrite the run", async () => {
    const run = await start();
    const { drops, score } = play(run);
    const first = await finishRun(db, { runId: run.runId, drops }, IP, LATER);
    const t2 = new Date(T.getTime() + 60_000);
    // A different (even empty) log the second time changes nothing.
    const second = await finishRun(db, { runId: run.runId, drops: [] }, IP, t2);
    expect(second).toEqual(first);
    const row = await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } });
    expect(row.score).toBe(score);
    expect(row.finishedAt?.getTime()).toBe(LATER.getTime());
  });

  it("concurrent duplicate finishes store one result", async () => {
    const run = await start();
    const { drops } = play(run);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => finishRun(db, { runId: run.runId, drops }, IP, LATER)),
    );
    for (const r of results) expect(r).toEqual(results[0]);
    expect(await db.gameRun.count({ where: { finishedAt: { not: null } } })).toBe(1);
  });

  it("answers NOT_FOUND for an unknown run id and VALIDATION for a malformed one", async () => {
    await expect(finishRun(db, { runId: crypto.randomUUID(), drops: [] }, IP, LATER)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(finishRun(db, { runId: "nope", drops: [] }, IP, LATER)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("a run can be finished long after 2 hours, until the weekly reset (exclusive)", async () => {
    const run = await start();
    const { drops, score } = play(run, 5);
    const reset = runExpiresAt(T); // Mon 2026-10-26 00:00 CDT
    expect(reset.toISOString()).toBe("2026-10-26T05:00:00.000Z");
    // At the reset (and after it) the run is expired and stays open.
    for (const at of [reset, new Date(reset.getTime() + 1)]) {
      await expect(finishRun(db, { runId: run.runId, drops }, IP, at)).rejects.toMatchObject({
        code: "VALIDATION",
        message: "这一局已经过期，请重新开始",
      });
    }
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } })).finishedAt).toBeNull();
    // 1 ms before the reset (days past the old 2 h TTL) it still counts, for the start's week.
    const res = await finishRun(db, { runId: run.runId, drops }, IP, new Date(reset.getTime() - 1));
    expect(res).toMatchObject({ score, week: { start: WEEK } });
  });

  it("across the fall DST change: a run started Mon 10-26 survives to Mon 11-02 00:00 CST", async () => {
    // Week of 2026-10-26 contains Sun 11-01 (CDT -> CST); the reset is 06:00Z, not 05:00Z.
    const started = new Date("2026-10-26T05:00:00Z"); // Mon 00:00 CDT, first instant of the week
    const run = await start("wx_dst", "Dst", IP, started);
    expect(run.expiresAt).toBe("2026-11-02T06:00:00.000Z");
    const { drops } = play(run, 5);
    await expect(
      finishRun(db, { runId: run.runId, drops }, IP, new Date("2026-11-02T06:00:00Z")),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const res = await finishRun(db, { runId: run.runId, drops }, IP, new Date("2026-11-02T05:30:00Z")); // Sun 23:30 CST
    expect(res.week).toEqual({ start: "2026-10-26", end: "2026-11-01" });
  });

  it("across the spring DST change: the week of 2027-03-08 resets at Mon 03-15 00:00 CDT", async () => {
    const started = new Date("2027-03-14T16:00:00Z"); // Sun 11:00 CDT (after the 02:00 jump)
    const run = await start("wx_spring", "Spr", IP, started);
    expect(run.expiresAt).toBe("2027-03-15T05:00:00.000Z");
    const { drops } = play(run, 5);
    await expect(
      finishRun(db, { runId: run.runId, drops }, IP, new Date("2027-03-15T05:00:00Z")),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const res = await finishRun(db, { runId: run.runId, drops }, IP, new Date("2027-03-15T04:59:59Z"));
    expect(res.week.start).toBe("2027-03-08");
  });

  it("rejects malformed and over-cap drop logs with VALIDATION and leaves the run open", async () => {
    const run = await start();
    const bad = async (drops: unknown) =>
      expect(finishRun(db, { runId: run.runId, drops }, IP, LATER)).rejects.toMatchObject({ code: "VALIDATION" });
    await bad("x");
    await bad([{ x: 0.5 }]);
    await bad([{ x: 2, at: 0 }]);
    await bad([{ x: -0.1, at: 0 }]);
    await bad([{ x: 0.5, at: 1.5 }]);
    await bad([{ x: 0.5, at: -1 }]);
    await bad([{ x: 0.5, at: 200_001 }]);
    await bad([{ x: "0.5", at: 0 }]);
    await bad(Array.from({ length: 601 }, (_, i) => ({ x: 0.5, at: i * 30 })));
    // Valid shape but impossible: cool-down violated, drops after game over.
    await bad([{ x: 0.5, at: 0 }, { x: 0.5, at: 10 }]);
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } })).finishedAt).toBeNull();
    // ...and the honest log still works afterwards.
    const { drops } = play(run, 8);
    await expect(finishRun(db, { runId: run.runId, drops }, IP, LATER)).resolves.toBeDefined();
  });

  it("refuses to finish a run whose wechat id got banned meanwhile", async () => {
    const run = await start();
    await db.gameBan.create({ data: { wechatId: "WX_ALICE" } });
    await expect(finishRun(db, { runId: run.runId, drops: [] }, IP, LATER)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it(`allows ${FINISH_LIMIT_PER_HOUR} finish calls per hour per IP`, async () => {
    const run = await start();
    await db.rateLimitHit.createMany({
      data: Array.from({ length: FINISH_LIMIT_PER_HOUR }, () => ({ key: `game_finish_ip:${IP}`, at: LATER })),
    });
    await expect(finishRun(db, { runId: run.runId, drops: [] }, IP, LATER)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("uses the tier snapshot from start, not today's tiers", async () => {
    const ids = await createDefaultProducts();
    const run = await start();
    const { drops, score } = play(run, 25);
    // The owner reconfigures tiers after the run started.
    await db.gameTier.createMany({
      data: [
        { productId: ids.brulee, sortOrder: 0 },
        { productId: ids.redBean, sortOrder: 1 },
      ],
    });
    const res = await finishRun(db, { runId: run.runId, drops }, IP, LATER);
    expect(res.score).toBe(score);
    const snap = (await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } })).tiersSnapshot as { id: string }[];
    expect(replay(run.seed, snap.map((t) => ({ ...(t as object) })) as never, drops).score).toBe(score);
  });
});

describe("best, rank and ties", () => {
  it("best is the player's best of the week; a lower run later keeps best", async () => {
    await insertRun({ wechatId: "wx_alice", score: 5000 });
    const run = await start("WX_ALICE", "Alice2"); // same id, other case
    const { drops, score } = play(run, 6);
    const res = await finishRun(db, { runId: run.runId, drops }, IP, LATER);
    expect(score).toBeLessThan(5000);
    expect(res).toMatchObject({ score, best: 5000, rank: 1 });
  });

  it("ranks players by their best, one row per wechat id (case-insensitive)", async () => {
    await insertRun({ wechatId: "wx_a", score: 300 });
    await insertRun({ wechatId: "WX_A", score: 100 });
    await insertRun({ wechatId: "wx_b", score: 500 });
    await insertRun({ wechatId: "wx_c", score: 200 });
    const board = await getLeaderboard(db, T);
    expect(board.top.map((r) => [r.rank, r.score])).toEqual([[1, 500], [2, 300], [3, 200]]);
  });

  it("ties are broken by the earliest finish", async () => {
    await insertRun({ wechatId: "wx_late", score: 400, finishedAt: new Date("2026-10-20T20:00:00Z") });
    await insertRun({ wechatId: "wx_early", score: 400, finishedAt: new Date("2026-10-20T10:00:00Z") });
    const board = await getLeaderboard(db, T);
    expect(board.top.map((r) => r.nickname)).toEqual(["wx_early", "wx_late"]);
    // A new run tying with the early one ranks behind it.
    const run = await start("wx_new", "New");
    const { drops, score } = play(run, 12);
    await db.gameRun.updateMany({ where: { wechatId: "wx_early" }, data: { score } });
    await db.gameRun.updateMany({ where: { wechatId: "wx_late" }, data: { score: score + 1 } });
    const res = await finishRun(db, { runId: run.runId, drops }, IP, new Date(T.getTime() + 3_600_000));
    expect(res.rank).toBe(3 - 0); // late (score+1), early (score, earlier), then new
  });

  it("hidden runs and banned ids are left out; a hidden best falls back to the next best", async () => {
    await insertRun({ wechatId: "wx_h", score: 900, hidden: true });
    await insertRun({ wechatId: "wx_h", score: 100 });
    await insertRun({ wechatId: "wx_ban", score: 800 });
    await insertRun({ wechatId: "wx_ok", score: 50 });
    await db.gameBan.create({ data: { wechatId: "WX_BAN" } });
    const board = await getLeaderboard(db, T, "wx_h");
    expect(board.top.map((r) => r.nickname)).toEqual(["wx_h", "wx_ok"]);
    expect(board.myBest).toBe(100);
  });

  it("only this week's runs count", async () => {
    await insertRun({ wechatId: "wx_old", score: 9999, weekKey: "2026-10-12" });
    await insertRun({ wechatId: "wx_now", score: 1 });
    const board = await getLeaderboard(db, T);
    expect(board.top.map((r) => r.nickname)).toEqual(["wx_now"]);
  });
});

describe("leaderboard", () => {
  it("returns the top 20 with masked ids only, the week and no myBest without an id", async () => {
    for (let i = 0; i < 25; i++) await insertRun({ wechatId: `player_${String(i).padStart(2, "0")}_id`, nickname: `Nick${i}`, score: 1000 - i });
    const board = await getLeaderboard(db, T);
    expect(board.top).toHaveLength(20);
    expect(board.week).toEqual({ start: WEEK, end: "2026-10-25" });
    expect(board.top[0]).toEqual({ rank: 1, nickname: "Nick0", wechatMasked: "pl***id", score: 1000 });
    expect(board.top.map((r) => r.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(board.lastWinner).toBeNull();
    expect("myBest" in board).toBe(false);
    expect(JSON.stringify(board)).not.toContain("player_00_id");
    for (const r of board.top) expect(Object.keys(r).sort()).toEqual(["nickname", "rank", "score", "wechatMasked"]);
  });

  it("myBest for the caller's id, even when outside the top 20", async () => {
    for (let i = 0; i < 22; i++) await insertRun({ wechatId: `p${i}_xx_id`, score: 1000 - i });
    await insertRun({ wechatId: "Me_Mine", score: 3 });
    expect((await getLeaderboard(db, T, "me_mine")).myBest).toBe(3);
    expect((await getLeaderboard(db, T, "nobody")).myBest).toBeUndefined();
  });

  it("lastWinner is the top of last week (masked), or the owner's award", async () => {
    await insertRun({ wechatId: "wx_prev1", nickname: "P1", score: 700, weekKey: "2026-10-12" });
    const second = await insertRun({ wechatId: "wx_prev2", nickname: "P2", score: 600, weekKey: "2026-10-12" });
    expect((await getLeaderboard(db, T)).lastWinner).toEqual({ nickname: "P1", wechatMasked: "wx***v1", score: 700 });
    await db.gameAward.create({ data: { weekKey: "2026-10-12", runId: second.id } });
    expect((await getLeaderboard(db, T)).lastWinner).toEqual({ nickname: "P2", wechatMasked: "wx***v2", score: 600 });
  });
});

describe("hasOrdered", () => {
  it("true for any order not CANCELLED/REJECTED, case-insensitively", async () => {
    const ids = await createDefaultProducts();
    await createSettings({ orderingEnabled: true });
    await createOpenDate("2026-10-21");
    expect(await hasOrdered(db, "wx_buyer")).toBe(false);
    await createOrder({ date: "2026-10-21", items: [{ productId: ids.redBean, qty: 1 }], wechatId: "Wx_Buyer", status: "CANCELLED" });
    await createOrder({ date: "2026-10-21", items: [{ productId: ids.redBean, qty: 1 }], wechatId: "wx_buyer", status: "REJECTED" });
    expect(await hasOrdered(db, "wx_buyer")).toBe(false);
    await createOrder({ date: "2026-10-21", items: [{ productId: ids.redBean, qty: 1 }], wechatId: "Wx_Buyer", status: "NEW" });
    expect(await hasOrdered(db, "wx_buyer")).toBe(true);
    expect(await hasOrdered(db, " WX_BUYER ")).toBe(true);
    expect(await hasOrdered(db, "someone_else")).toBe(false);
  });
});

describe("routes", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("start -> finish -> leaderboard end to end", async () => {
    await createDefaultProducts();
    const sres = await startPOST(jsonRequest("/api/game/start", { wechatId: "wx_route", nickname: "Rou" }, { "x-forwarded-for": "1.2.3.4" }));
    expect(sres.status).toBe(201);
    expect(sres.headers.get("cache-control")).toBe("no-store");
    const run = await sres.json();
    const { drops, score } = play(run);
    vi.setSystemTime(LATER);
    const fres = await finishPOST(jsonRequest("/api/game/finish", { runId: run.runId, drops }, { "x-forwarded-for": "1.2.3.4" }));
    expect(fres.status).toBe(200);
    expect(await fres.json()).toMatchObject({ score, best: score, rank: 1 });
    const lres = await leaderboardGET(getRequest("/api/game/leaderboard?wechatId=wx_route"));
    const board = await lres.json();
    expect(board.top[0]).toEqual({ rank: 1, nickname: "Rou", wechatMasked: "wx***te", score });
    expect(board.myBest).toBe(score);
    expect(lres.headers.get("cache-control")).toBe("no-store");
    const viaHeader = await (await leaderboardGET(getRequest("/api/game/leaderboard", { "x-game-wechat": "wx_route" }))).json();
    expect(viaHeader.myBest).toBe(score);
  });

  it("the raw ip never reaches the database", async () => {
    const res = await startPOST(jsonRequest("/api/game/start", { wechatId: "wx_ip", nickname: "I" }, { "x-forwarded-for": "9.9.9.9" }));
    const { runId } = await res.json();
    const row = await db.gameRun.findUniqueOrThrow({ where: { id: runId } });
    expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("9.9.9.9");
  });

  it("requires a JSON content type, a JSON object and a bounded body", async () => {
    const plain = new Request("http://localhost:3111/api/game/start", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ wechatId: "a", nickname: "b" }),
    });
    expect((await startPOST(plain)).status).toBe(422);
    expect((await startPOST(jsonRequest("/api/game/start", "not json"))).status).toBe(422);
    expect((await startPOST(jsonRequest("/api/game/start", "[]"))).status).toBe(422);
    const huge = jsonRequest("/api/game/start", { wechatId: "a", nickname: "b", pad: "x".repeat(10_000) });
    expect((await startPOST(huge)).status).toBe(422);
    const hugeFinish = jsonRequest("/api/game/finish", { runId: crypto.randomUUID(), drops: [], pad: "x".repeat(70_000) });
    expect((await finishPOST(hugeFinish)).status).toBe(422);
  });

  it("maps errors to the API shape", async () => {
    const res = await finishPOST(jsonRequest("/api/game/finish", { runId: crypto.randomUUID(), drops: [] }));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "NOT_FOUND" });
    const banned = await db.gameBan.create({ data: { wechatId: "Zed" } });
    expect(banned.id).toBeTruthy();
    const b = await startPOST(jsonRequest("/api/game/start", { wechatId: "zed", nickname: "z" }));
    expect(b.status).toBe(422);
    expect((await b.json()).message).toContain("不能参加游戏");
  });
});

describe("review fixes", () => {
  it("isBanned and hasOrdered treat % and _ literally (no LIKE wildcards)", async () => {
    const ids = await createDefaultProducts();
    await createSettings({ orderingEnabled: true });
    await createOpenDate("2026-10-21");
    await db.gameBan.create({ data: { wechatId: "ab_cd" } });
    await createOrder({ date: "2026-10-21", items: [{ productId: ids.redBean, qty: 1 }], wechatId: "abXcd" });
    expect(await isBanned(db, "%")).toBe(false);
    expect(await isBanned(db, "ab%")).toBe(false);
    expect(await isBanned(db, "abXcd")).toBe(false);
    expect(await isBanned(db, "AB_CD")).toBe(true);
    expect(await hasOrdered(db, "%")).toBe(false);
    expect(await hasOrdered(db, "ab_cd")).toBe(false);
    expect(await hasOrdered(db, "a%")).toBe(false);
    expect(await hasOrdered(db, "ABXCD")).toBe(true);
    // A player called "%" can start a game (not "banned") and is not eligible.
    await expect(start("%", "Pct")).resolves.toBeDefined();
  });

  it("GameBan and GameAward ids have a database default (raw inserts work)", async () => {
    await db.$executeRaw`INSERT INTO "GameBan" ("wechatId", "reason", "createdAt") VALUES ('raw1', 'x', now())`;
    const run = await insertRun({ wechatId: "w", score: 1 });
    await db.$executeRaw`INSERT INTO "GameAward" ("weekKey", "runId") VALUES ('2026-10-19', ${run.id}::uuid)`;
    await db.$executeRaw`INSERT INTO "GameTier" ("sortOrder") VALUES (0)`;
    expect(await db.gameBan.count()).toBe(1);
    expect(await db.gameAward.count()).toBe(1);
  });

  it("an empty-string image means no image: falls back to the product photo or the logo", async () => {
    const ids = await createDefaultProducts();
    await db.product.update({ where: { id: ids.redBean }, data: { imageUrl: "/api/images/cover.webp" } });
    await db.gameTier.createMany({
      data: [
        { productId: ids.redBean, sortOrder: 0, imageUrl: "" },
        { productId: ids.brulee, sortOrder: 1, imageUrl: "" },
        { sortOrder: 9, isBig: true, imageUrl: "" },
      ],
    });
    const r = await start();
    expect(r.tiers[0].imageUrl).toBe("/api/images/cover.webp");
    expect(r.tiers[1].imageUrl).toBeNull();
    expect(r.tiers[2].imageUrl).toBe("/brand/logo.webp");
  });

  it("tier colours are the products' home colours (presets cycle by tier index when unset)", async () => {
    const ids = await createDefaultProducts();
    await db.product.update({ where: { id: ids.redBean }, data: { fieldColor: "#B05219" } });
    await db.product.update({ where: { id: ids.rockCheese }, data: { fieldColor: null } });
    const r = await start();
    expect(r.tiers[0].color).toEqual({ bg: "#B05219", ink: "#FFF8EE" });
    expect(r.tiers[1].color.bg).toBe("#F0BF45"); // no colour set: the D95 presets cycle by tier index
  });

  it("rejects invisible format characters in nicknames", async () => {
    for (const code of [0x200b, 0xfeff, 0x200f, 0x2060]) {
      const nick = `a${String.fromCharCode(code)}b`;
      await expect(start("wx", nick)).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });

  it("stores the drop log, its count and the simulated length on a finished run", async () => {
    const run = await start();
    const { drops } = play(run, 12);
    await finishRun(db, { runId: run.runId, drops }, IP, LATER);
    const row = await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } });
    expect(row.drops).toEqual(drops);
    expect(row.dropCount).toBe(12);
    expect(row.simSteps).toBeGreaterThan(drops[drops.length - 1].at);
  });

  it("rejects simulated time that exceeds the real time since start (plus slack)", async () => {
    await createDefaultProducts();
    // The seed is random: start runs until one lasts long enough to make the check meaningful.
    let run = await start();
    let { drops } = play(run, 40);
    for (let i = 0; i < 30 && drops[drops.length - 1].at / 120 <= 12; i++) {
      run = await start();
      ({ drops } = play(run, 40));
    }
    const lastAt = drops[drops.length - 1].at;
    expect(lastAt / 120).toBeGreaterThan(12);
    // Submitted a few seconds after start: impossible for a real client.
    await expect(
      finishRun(db, { runId: run.runId, drops }, IP, new Date(T.getTime() + 1000)),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    // After the game would really have taken it is accepted. A game that ended counts until its game
    // over (the 1.5 s over timer and the settling after the last drop), so use the replay's own steps.
    const r = replay(run.seed, run.tiers, drops);
    const played = r.over ? r.steps : lastAt;
    const ok = new Date(T.getTime() + (played / 120) * 1000);
    await expect(finishRun(db, { runId: run.runId, drops }, IP, ok)).resolves.toBeDefined();
  });

  it("cleanup deletes unfinished runs of past weeks only (they expired) and keeps finished and this week's ones", async () => {
    const old = new Date(T.getTime() - 25 * 3_600_000);
    const lastWeek = new Date("2026-10-19T04:59:59Z"); // Sun 10-18 23:59:59 CDT
    const mk = (finishedAt: Date | null, startedAt: Date) =>
      db.gameRun.create({
        data: { seed: "s", wechatId: "w", nickname: "n", tiersSnapshot: [], startedAt, finishedAt, score: finishedAt ? 1 : null, ipHash: "h" },
      });
    const stale = await mk(null, lastWeek);
    // Started yesterday, this week: still resumable (D111), only its IP hash goes.
    const resumable = await mk(null, old);
    const done = await mk(old, old);
    const fresh = await mk(null, new Date(T.getTime() - 3_600_000));
    await cleanup(db, T);
    expect(await db.gameRun.findUnique({ where: { id: stale.id } })).toBeNull();
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: resumable.id } })).ipHash).toBeNull();
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: done.id } })).ipHash).toBeNull();
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: fresh.id } })).ipHash).toBe("h");
  });

  it("a run started before Monday 00:00 cannot be finished after it (the reset ends it, D111)", async () => {
    const sunday = new Date("2026-10-26T04:30:00Z"); // Sun 23:30 CDT, week of 10-19
    const run = await start("wx_sun", "Sun", IP, sunday);
    expect(run.expiresAt).toBe("2026-10-26T05:00:00.000Z");
    const { drops } = play(run, 6);
    const monday = new Date("2026-10-26T05:30:00Z"); // Mon 00:30 CDT
    await expect(finishRun(db, { runId: run.runId, drops }, IP, monday)).rejects.toMatchObject({ code: "VALIDATION" });
    const res = await finishRun(db, { runId: run.runId, drops }, IP, new Date("2026-10-26T04:59:00Z"));
    expect(res.week.start).toBe("2026-10-19");
  });
});

describe("all-time record, personalBest and newRecord (D113)", () => {
  it("allTime is null with no eligible runs, then the highest score of all weeks (masked)", async () => {
    expect((await getLeaderboard(db, T)).allTime).toBeNull();
    await insertRun({ wechatId: "wx_old_king", nickname: "Old", score: 9000, weekKey: "2026-09-28" });
    await insertRun({ wechatId: "wx_now", nickname: "Now", score: 500 });
    const board = await getLeaderboard(db, T);
    expect(board.allTime).toEqual({ nickname: "Old", wechatMasked: "wx***ng", score: 9000 });
    expect(Object.keys(board.allTime!).sort()).toEqual(["nickname", "score", "wechatMasked"]);
    expect(JSON.stringify(board)).not.toContain("wx_old_king");
  });

  it("allTime leaves out hidden runs and banned ids (case-insensitive); ties go to the earliest finish", async () => {
    await insertRun({ wechatId: "wx_hidden", score: 9999, hidden: true });
    await insertRun({ wechatId: "wx_banned", score: 8888, weekKey: "2026-10-12" });
    await db.gameBan.create({ data: { wechatId: "WX_BANNED" } });
    await insertRun({ wechatId: "wx_late", nickname: "Late", score: 700, finishedAt: new Date("2026-10-20T12:00:00Z") });
    await insertRun({ wechatId: "wx_early", nickname: "Early", score: 700, finishedAt: new Date("2026-10-14T12:00:00Z"), weekKey: "2026-10-12" });
    expect((await getLeaderboard(db, T)).allTime).toMatchObject({ nickname: "Early", score: 700 });
    await db.gameRun.updateMany({ where: { wechatId: "wx_hidden" }, data: { hidden: false } });
    expect((await getLeaderboard(db, T)).allTime).toMatchObject({ score: 9999 });
  });

  it("personalBest is the all-time best of the id (any week, any case), this run included, hidden runs not counted", async () => {
    await insertRun({ wechatId: "wx_pb", score: 4000, weekKey: "2026-10-05" });
    await insertRun({ wechatId: "WX_PB", score: 99999, weekKey: "2026-10-12", hidden: true });
    await insertRun({ wechatId: "wx_other", score: 50000 });
    const run = await start("wx_PB", "Pb");
    const { drops, score } = play(run, 6);
    expect(score).toBeLessThan(4000);
    const res = await finishRun(db, { runId: run.runId, drops }, IP, LATER);
    // best/rank stay weekly; personalBest is all-time.
    expect(res).toMatchObject({ score, best: score, rank: 2, personalBest: 4000, newRecord: false });
  });

  it("personalBest is this run's score when it is the player's best", async () => {
    await insertRun({ wechatId: "wx_pb2", score: 1, weekKey: "2026-10-05" });
    const run = await start("wx_pb2", "Pb2");
    const { drops, score } = play(run, 10);
    const res = await finishRun(db, { runId: run.runId, drops }, IP, LATER);
    expect(res.personalBest).toBe(score);
  });

  it("newRecord: true for the first finished run ever and when strictly beating the record; false on a tie", async () => {
    const first = await start("wx_first", "F");
    const p = play(first, 10);
    expect((await finishRun(db, { runId: first.runId, drops: p.drops }, IP, LATER)).newRecord).toBe(true);

    // A tie with the record is not a new record (the earlier finish keeps the crown).
    const tie = await start("wx_tie", "T", IP, new Date(T.getTime() + 1000));
    await finishRun(db, { runId: tie.runId, drops: p.drops }, IP, new Date(LATER.getTime() + 1000));
    // Another seed scores differently: force the tie through the stored score; a repeated finish recomputes.
    await db.gameRun.update({ where: { id: tie.runId }, data: { score: p.score } });
    const again = await finishRun(db, { runId: tie.runId, drops: [] }, IP, new Date(LATER.getTime() + 2000));
    expect(again.newRecord).toBe(false);

    // Lower the record below a fresh run: that run beats it strictly.
    await db.gameRun.updateMany({ where: { wechatId: { in: ["wx_first", "wx_tie"] } }, data: { score: 0 } });
    const champ = await start("wx_champ", "C");
    const c = play(champ, 10);
    expect(c.score).toBeGreaterThan(0);
    const res = await finishRun(db, { runId: champ.runId, drops: c.drops }, IP, LATER);
    expect(res.newRecord).toBe(true);
    expect((await getLeaderboard(db, LATER)).allTime).toMatchObject({ nickname: "C", score: c.score });
    // Lower than the record: false.
    await db.gameRun.update({ where: { id: champ.runId }, data: { score: c.score } });
    await insertRun({ wechatId: "wx_huge", score: c.score + 1000, weekKey: "2026-10-05" });
    const low = await start("wx_low", "L");
    const l = play(low, 3);
    expect((await finishRun(db, { runId: low.runId, drops: l.drops }, IP, LATER)).newRecord).toBe(false);
  });

  it("the finish route returns personalBest and newRecord; the leaderboard route returns allTime", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(T);
      const run = await (await startPOST(jsonRequest("/api/game/start", { wechatId: "wx_api", nickname: "Api" }))).json();
      expect(run.expiresAt).toBe("2026-10-26T05:00:00.000Z");
      const { drops, score } = play(run);
      vi.setSystemTime(LATER);
      const body = await (await finishPOST(jsonRequest("/api/game/finish", { runId: run.runId, drops }))).json();
      expect(body).toMatchObject({ score, personalBest: score, newRecord: true });
      const board = await (await leaderboardGET(getRequest("/api/game/leaderboard"))).json();
      expect(board.allTime).toEqual({ nickname: "Api", wechatMasked: "wx***pi", score });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("case-insensitive ban uniqueness", () => {
  it("the database refuses a second ban that differs only by case", async () => {
    await db.gameBan.create({ data: { wechatId: "Foo" } });
    await expect(db.gameBan.create({ data: { wechatId: "fOO" } })).rejects.toBeDefined();
  });
});
