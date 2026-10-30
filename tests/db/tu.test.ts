// 兔了个兔 server (C6, D121-D124): start, finish (replay + plausibility + suspicious flag),
// weekly board, all-time record, separation from 消除大面包, routes, cleanup.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
import { GET as bigLeaderboardGET } from "@/app/api/game/leaderboard/route";
import { POST as bigFinishPOST } from "@/app/api/game/finish/route";
import { GET as leaderboardGET } from "@/app/api/game/tu/leaderboard/route";
import { POST as finishPOST } from "@/app/api/game/tu/finish/route";
import { POST as startPOST } from "@/app/api/game/tu/start/route";
import { createTuGame, MAX_TAPS, MIN_TAP_GAP_MS, tuSeed, type TuTap } from "@/lib/tu";
import { prisma } from "@/server/db";
import { finishRun, getLeaderboard, PLAUSIBILITY_SLACK_MS, START_LIMIT_PER_HOUR, startRun } from "@/server/game";
import { cleanup } from "@/server/maintenance";
import { finishTuRun, getTuLeaderboard, isSuspicious, startTuRun } from "@/server/tu";
import { greedyTu, randomTu } from "../support/tuBot";
import { getRequest, jsonRequest, NOW } from "./api.helpers";
import { createDefaultProducts, db, resetDb } from "./helpers";

process.env.IP_HASH_SECRET = "test-secret";

const IP = "iphash-a";
const T = NOW; // Tue 2026-10-20, week of Monday 2026-10-19 (Chicago)
const WEEK = "2026-10-19";
const LATER = new Date(T.getTime() + 60 * 60_000);

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
});

async function start(wechatId = "wx_alice", nickname = "Alice", ip = IP, now = T) {
  return startTuRun(db, { wechatId, nickname }, ip, now);
}

/** A greedy bot game on the run's own seed and tiers (gaps 150-1050 ms). */
function play(run: Awaited<ReturnType<typeof start>>, maxTaps?: number) {
  return greedyTu(run.seed, run.tiers, maxTaps);
}

async function insertRun(o: {
  wechatId: string;
  nickname?: string;
  score: number;
  finishedAt?: Date;
  weekKey?: string;
  hidden?: boolean;
  game?: "BIG" | "TU";
}) {
  return db.gameRun.create({
    data: {
      game: o.game ?? "TU",
      seed: "s",
      wechatId: o.wechatId,
      nickname: o.nickname ?? o.wechatId,
      tiersSnapshot: [],
      startedAt: o.finishedAt ?? T,
      finishedAt: o.finishedAt ?? T,
      score: o.score,
      weekKey: o.weekKey ?? WEEK,
      hidden: o.hidden ?? false,
    },
  });
}

describe("start", () => {
  it("returns the C6 shape with the bread tiers only (no 大面包), same TierView as game 1", async () => {
    const ids = await createDefaultProducts();
    const r = await start();
    expect(Object.keys(r).sort()).toEqual(["expiresAt", "runId", "seed", "tiers"]);
    expect(r.seed).toMatch(/^v2\.[0-9a-f]{32}$/);
    expect(r.expiresAt).toBe("2026-10-26T05:00:00.000Z");
    expect(r.tiers.map((t) => t.id)).toEqual([ids.redBean, ids.rockCheese, ids.cheeseHorn, ids.brulee]);
    for (const t of r.tiers) expect(Object.keys(t).sort()).toEqual(["color", "id", "imageUrl", "name", "points", "radius"]);
    // The same bread tiers game 1 gets, without its big tier.
    const big = await startRun(db, { wechatId: "wx_b", nickname: "B" }, IP, T);
    expect(big.tiers.slice(0, -1)).toEqual(r.tiers);
    const row = await db.gameRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(row).toMatchObject({ game: "TU", ipHash: IP, finishedAt: null });
    expect(row.tiersSnapshot).toEqual(JSON.parse(JSON.stringify(r.tiers)));
  });

  it("owner-configured tiers: the big row is left out", async () => {
    const ids = await createDefaultProducts();
    await db.gameTier.createMany({
      data: [
        { productId: ids.brulee, sortOrder: 1 },
        { productId: ids.redBean, sortOrder: 0 },
        { sortOrder: 99, isBig: true },
      ],
    });
    const rows = await db.gameTier.findMany({ where: { isBig: false }, orderBy: { sortOrder: "asc" } });
    expect(rows.map((r) => r.productId)).toEqual([ids.redBean, ids.brulee]);
    expect((await start()).tiers.map((t) => t.id)).toEqual(rows.map((r) => r.id));
  });

  it("with fewer than 2 bread tiers answers a clean VALIDATION (Chinese) and stores nothing", async () => {
    await db.product.create({ data: { name: "唯一", unitPriceCents: 100, capacityMode: "INDEPENDENT", dailyLimit: 5, description: "" } });
    await expect(start()).rejects.toMatchObject({ code: "VALIDATION", message: "兔了个兔还没准备好，请稍后再来" });
    expect(await db.gameRun.count()).toBe(0);
  });

  it("is playable with no products at all (the image-less default tiers)", async () => {
    expect((await start()).tiers.map((t) => t.id)).toEqual(["t0", "t1"]);
  });

  it("validates the wechat id and nickname like game 1, refuses banned ids (shared list)", async () => {
    await expect(start("", "A")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(start("wx", "12345678901")).rejects.toMatchObject({ code: "VALIDATION" });
    await db.gameBan.create({ data: { wechatId: "BadGuy" } });
    await expect(start("badguy", "x")).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("不能参加游戏") });
    expect(await db.gameRun.count()).toBe(0);
  });

  it(`rate limits ${START_LIMIT_PER_HOUR} starts per hour per IP on its own key (game 1's starts do not count)`, async () => {
    await db.rateLimitHit.createMany({
      data: Array.from({ length: START_LIMIT_PER_HOUR }, () => ({ key: `game_start_ip:${IP}`, at: T })),
    });
    await expect(start()).resolves.toBeDefined();
    await db.rateLimitHit.createMany({
      data: Array.from({ length: START_LIMIT_PER_HOUR }, () => ({ key: `tu_start_ip:${IP}`, at: T })),
    });
    await expect(start()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(start("wx", "A", "other-ip")).resolves.toBeDefined();
  });
});

describe("finish", () => {
  it("replays the tap log and stores the verified score, taps, count, play time and flag", async () => {
    await createDefaultProducts();
    const run = await start();
    // D127: a completed game well below MAX_TAPS, with human-paced tap gaps.
    const seed = tuSeed("7e57f1a5");
    await db.gameRun.update({ where: { id: run.runId }, data: { seed } });
    const bot = play({ ...run, seed });
    bot.taps = bot.taps.map((tap, i) => ({ ...tap, at: (i + 1) * 500 }));
    expect(bot.over).toBe(true);
    // C8: the log mixes tile taps and prop uses.
    expect(bot.taps.filter((t) => "p" in t).length).toBeGreaterThan(0);
    expect(bot.taps).toHaveLength(59);
    const res = await finishTuRun(db, { runId: run.runId, taps: bot.taps, score: 999_999 }, IP, LATER);
    expect(res).toEqual({
      score: bot.score,
      best: bot.score,
      rank: 1,
      week: { start: WEEK, end: "2026-10-25" },
      personalBest: bot.score,
      newRecord: true,
    });
    const row = await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } });
    expect(row).toMatchObject({
      game: "TU",
      score: bot.score,
      weekKey: WEEK,
      finishedAt: LATER,
      dropCount: bot.taps.length,
      playMs: bot.taps[bot.taps.length - 1].at,
      simSteps: null,
      suspicious: false,
    });
    expect(row.drops).toEqual(bot.taps);
  });

  it("an unfinished run (the player quit) is scored as far as it got", async () => {
    await createDefaultProducts();
    const run = await start();
    const bot = play(run, 6);
    expect(bot.over).toBe(false);
    expect((await finishTuRun(db, { runId: run.runId, taps: bot.taps }, IP, LATER)).score).toBe(bot.score);
  });

  it("is idempotent, and concurrent duplicates store one result", async () => {
    await createDefaultProducts();
    const run = await start();
    const bot = play(run);
    const [a, b] = await Promise.all([
      finishTuRun(db, { runId: run.runId, taps: bot.taps }, IP, LATER),
      finishTuRun(db, { runId: run.runId, taps: bot.taps }, IP, LATER),
    ]);
    expect(a).toEqual(b);
    const again = await finishTuRun(db, { runId: run.runId, taps: bot.taps.slice(0, 3) }, IP, new Date(LATER.getTime() + 1000));
    expect(again.score).toBe(bot.score);
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } })).finishedAt).toEqual(LATER);
  });

  it("NOT_FOUND for an unknown run and for a run of the other game (both ways)", async () => {
    await createDefaultProducts();
    await expect(finishTuRun(db, { runId: crypto.randomUUID(), taps: [] }, IP, LATER)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const big = await startRun(db, { wechatId: "wx", nickname: "A" }, IP, T);
    await expect(finishTuRun(db, { runId: big.runId, taps: [] }, IP, LATER)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const tu = await start();
    await expect(finishRun(db, { runId: tu.runId, drops: [] }, IP, LATER)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(finishTuRun(db, { runId: "nope", taps: [] }, IP, LATER)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects what a real client cannot produce with VALIDATION and leaves the run open", async () => {
    await createDefaultProducts();
    const run = await start();
    const { taps } = play(run);
    const g = createTuGame({ seed: run.seed, tiers: run.tiers });
    const covered = g.state().tiles.find((t) => !t.free)!.id;
    const bad: unknown[] = [
      [{ id: covered, at: 500 }], // covered tile
      [{ id: 99_999, at: 500 }], // unknown tile
      [taps[0], { ...taps[1], at: taps[0].at }], // not increasing
      [{ ...taps[0], at: 1.5 }], // not an integer
      [{ ...taps[0], at: -1 }],
      [{ id: "1", at: 5 }],
      Array.from({ length: MAX_TAPS + 1 }, (_, i) => ({ id: 1, at: i * 200 })), // over the cap
      "taps",
      [...taps, { id: 1, at: taps[taps.length - 1].at + 500 }], // a tap after game over
    ];
    for (const b of bad) {
      await expect(finishTuRun(db, { runId: run.runId, taps: b }, IP, LATER), JSON.stringify(b).slice(0, 80)).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } })).finishedAt).toBeNull();
    await expect(finishTuRun(db, { runId: run.runId, taps }, IP, LATER)).resolves.toBeDefined();
  });

  it("rejects malformed or unusable prop entries (C8) with VALIDATION and leaves the run open", async () => {
    await createDefaultProducts();
    const run = await start();
    const free = createTuGame({ seed: run.seed, tiers: run.tiers }).state().tiles.find((t) => t.free)!.id;
    const bad: unknown[] = [
      [{ p: "shuffle", at: 500 }], // not one of our props
      [{ p: "peek", id: free, at: 500 }], // both kinds at once
      [{ p: "peek", at: 500, extra: 1 }], // unknown key
      [{ p: "peek" }], // no time
      [{ p: "peek", at: 500 }, { p: "peek", at: 1000 }], // only one peek at the start
      [{ p: "bag", at: 500 }, { p: "bag", at: 1000 }], // the extra slot once per batch
      [{ id: free, at: 500 }, { p: "swap", at: 500 }], // not increasing across kinds
      [{ p: "peek", at: 500 }, { id: free, at: 550 }], // gap under MIN_TAP_GAP_MS across kinds
    ];
    for (const b of bad) {
      await expect(finishTuRun(db, { runId: run.runId, taps: b }, IP, LATER), JSON.stringify(b)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } })).finishedAt).toBeNull();
    const ok = [{ p: "peek", at: 500 }, { id: free, at: 1000 }, { p: "bag", at: 1500 }, { p: "swap", at: 2000 }];
    const want = createTuGame({ seed: run.seed, tiers: run.tiers });
    want.use("peek");
    want.tap(free);
    expect((await finishTuRun(db, { runId: run.runId, taps: ok }, IP, LATER)).score).toBe(want.score);
    const row = await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } });
    expect(row).toMatchObject({ drops: ok, dropCount: 4, playMs: 2000 });
  });

  it("a run dealt by an older engine version (plain hex seed from before C8) can no longer be finished", async () => {
    await createDefaultProducts();
    const run = await start();
    // What a run started before the deploy looks like: a 32-hex seed without the version prefix.
    const oldSeed = "0123456789abcdef0123456789abcdef";
    await db.gameRun.update({ where: { id: run.runId }, data: { seed: oldSeed } });
    // Even a log that is valid for that seed under today's engine is refused, so nothing replays wrongly.
    const { taps } = greedyTu(oldSeed, run.tiers, 20);
    await expect(finishTuRun(db, { runId: run.runId, taps }, IP, LATER)).rejects.toMatchObject({
      code: "VALIDATION",
      message: "这一局已经过期，请重新开始",
    });
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } })).finishedAt).toBeNull();
    // A future version is refused the same way.
    await db.gameRun.update({ where: { id: run.runId }, data: { seed: `v99.${oldSeed}` } });
    await expect(finishTuRun(db, { runId: run.runId, taps }, IP, LATER)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it(`rejects two taps closer than ${MIN_TAP_GAP_MS} ms; exactly ${MIN_TAP_GAP_MS} is fine`, async () => {
    await createDefaultProducts();
    const run = await start();
    const { taps } = play(run, 10);
    const spaced = (gap: number) => taps.map((t, i) => ({ ...t, at: 1000 + i * gap }));
    const tooFast = spaced(MIN_TAP_GAP_MS).map((t, i) => (i === 5 ? { ...t, at: t.at - 1 } : t));
    await expect(finishTuRun(db, { runId: run.runId, taps: tooFast }, IP, LATER)).rejects.toMatchObject({
      code: "VALIDATION",
      message: "这一局的成绩没能通过验证",
    });
    await expect(finishTuRun(db, { runId: run.runId, taps: spaced(MIN_TAP_GAP_MS) }, IP, LATER)).resolves.toBeDefined();
  });

  it("rejects a last tap later than the real time since start plus slack", async () => {
    await createDefaultProducts();
    const run = await start();
    const { taps } = play(run, 10);
    const lastAt = taps[taps.length - 1].at;
    const early = new Date(T.getTime() + lastAt - PLAUSIBILITY_SLACK_MS - 1);
    await expect(finishTuRun(db, { runId: run.runId, taps }, IP, early)).rejects.toMatchObject({ code: "VALIDATION" });
    const ok = new Date(T.getTime() + lastAt - PLAUSIBILITY_SLACK_MS);
    await expect(finishTuRun(db, { runId: run.runId, taps }, IP, ok)).resolves.toBeDefined();
  });

  it("a run lives until the weekly reset after its start (exclusive)", async () => {
    await createDefaultProducts();
    const sunday = new Date("2026-10-26T04:30:00Z");
    const run = await start("wx_sun", "Sun", IP, sunday);
    const { taps } = play(run, 6);
    await expect(finishTuRun(db, { runId: run.runId, taps }, IP, new Date("2026-10-26T05:00:00Z"))).rejects.toMatchObject({
      code: "VALIDATION",
      message: "这一局已经过期，请重新开始",
    });
    expect((await finishTuRun(db, { runId: run.runId, taps }, IP, new Date("2026-10-26T04:59:00Z"))).week.start).toBe(WEEK);
  });

  it("refuses to finish a run whose wechat id got banned meanwhile", async () => {
    await createDefaultProducts();
    const run = await start("wx_x");
    await db.gameBan.create({ data: { wechatId: "WX_X" } });
    await expect(finishTuRun(db, { runId: run.runId, taps: play(run, 3).taps }, IP, LATER)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("uses the tier snapshot from start, not today's tiers", async () => {
    const ids = await createDefaultProducts();
    const run = await start();
    const bot = play(run);
    await db.product.update({ where: { id: ids.rockCheese }, data: { status: "PAUSED" } });
    expect((await finishTuRun(db, { runId: run.runId, taps: bot.taps }, IP, LATER)).score).toBe(bot.score);
  });
});

describe("suspicious flag (D103 manual check)", () => {
  const at = (gaps: number[]): TuTap[] => {
    let t = 0;
    return gaps.map((g, i) => ({ id: i + 1, at: (t += g) }));
  };

  it("median tap gap under 300 ms, or MAX_TAPS reached", () => {
    expect(isSuspicious([])).toBe(false);
    expect(isSuspicious(at([5]))).toBe(false);
    expect(isSuspicious(at([0, 299, 299]))).toBe(true);
    expect(isSuspicious(at([0, 300, 300]))).toBe(false);
    expect(isSuspicious(at([0, 200, 400]))).toBe(false); // median of 200 and 400 = 300
    expect(isSuspicious(at([0, 200, 398]))).toBe(true);
    expect(isSuspicious(at([0, 1000, 120, 120, 120, 5000]))).toBe(true);
    expect(isSuspicious(at(Array.from({ length: MAX_TAPS }, () => 800)))).toBe(true);
  });

  it("a fast (but plausible) run is stored with suspicious = true and still counts on the board", async () => {
    await createDefaultProducts();
    const run = await start("wx_fast", "Fast");
    const fast = play(run).taps.map((t, i) => ({ ...t, at: i * 200 }));
    const res = await finishTuRun(db, { runId: run.runId, taps: fast }, IP, LATER);
    expect(res.rank).toBe(1);
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } })).suspicious).toBe(true);
    expect((await getTuLeaderboard(db, LATER)).top[0].nickname).toBe("Fast");
  });

  it("a run that reaches MAX_TAPS (2 bread tiers never fill the bag) is flagged", async () => {
    await db.product.createMany({
      data: [
        { name: "甲", unitPriceCents: 100, capacityMode: "INDEPENDENT", dailyLimit: 5, description: "", sortOrder: 0 },
        { name: "乙", unitPriceCents: 100, capacityMode: "INDEPENDENT", dailyLimit: 5, description: "", sortOrder: 1 },
      ],
    });
    const run = await start("wx_long", "Long");
    expect(run.tiers).toHaveLength(2);
    const bot = play(run);
    expect(bot.taps).toHaveLength(MAX_TAPS);
    const now = new Date(T.getTime() + bot.taps[bot.taps.length - 1].at + 1000);
    const res = await finishTuRun(db, { runId: run.runId, taps: bot.taps }, IP, now);
    expect(res.score).toBe(bot.score);
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } })).suspicious).toBe(true);
  });
});

describe("board, record and separation from 消除大面包", () => {
  it("weekly board: best per wechat id (case-insensitive), ties earliest, hidden and banned left out", async () => {
    await insertRun({ wechatId: "wx_ali", score: 300, finishedAt: new Date(T.getTime() - 5000) });
    await insertRun({ wechatId: "WX_ALI", score: 500, finishedAt: new Date(T.getTime() - 4000) });
    await insertRun({ wechatId: "wx_bob", score: 500, finishedAt: new Date(T.getTime() - 6000) });
    await insertRun({ wechatId: "wx_h", score: 900, hidden: true });
    await insertRun({ wechatId: "wx_ban", score: 800 });
    await insertRun({ wechatId: "wx_old", score: 9999, weekKey: "2026-10-12", finishedAt: new Date("2026-10-14T12:00:00Z") });
    await db.gameBan.create({ data: { wechatId: "WX_BAN" } });
    const board = await getTuLeaderboard(db, T, "wx_ali");
    expect(board.top.map((r) => [r.rank, r.wechatMasked, r.score])).toEqual([
      [1, "wx***ob", 500],
      [2, "WX***LI", 500],
    ]);
    expect(board.myBest).toBe(500);
    expect(board.lastWinner).toMatchObject({ score: 9999 });
    expect(board.allTime).toMatchObject({ score: 9999 });
  });

  it("the two games never mix: boards, all-time record, personalBest, lastWinner awards", async () => {
    await insertRun({ wechatId: "wx_big", score: 5000, game: "BIG" });
    await insertRun({ wechatId: "wx_tu", score: 40, game: "TU" });
    await insertRun({ wechatId: "wx_lastbig", score: 7, game: "BIG", weekKey: "2026-10-12", finishedAt: new Date("2026-10-14T12:00:00Z") });
    const lastTu = await insertRun({ wechatId: "wx_lasttu", score: 3, game: "TU", weekKey: "2026-10-12", finishedAt: new Date("2026-10-14T12:00:00Z") });
    const tu = await getTuLeaderboard(db, T, "wx_big");
    expect(tu.top.map((r) => r.score)).toEqual([40]);
    expect(tu.allTime?.score).toBe(40);
    expect(tu.lastWinner?.score).toBe(3);
    expect(tu.myBest).toBeUndefined();
    const big = await getLeaderboard(db, T, "wx_tu");
    expect(big.top.map((r) => r.score)).toEqual([5000]);
    expect(big.allTime?.score).toBe(5000);
    expect(big.lastWinner?.score).toBe(7);
    expect(big.myBest).toBeUndefined();
    // A 兔了个兔 award for last week names its winner on its own board only (same week as no game-1 award).
    await db.gameAward.create({ data: { game: "TU", weekKey: "2026-10-12", runId: lastTu.id } });
    expect((await getLeaderboard(db, T)).lastWinner?.score).toBe(7);
    expect((await getTuLeaderboard(db, T)).lastWinner?.score).toBe(3);
  });

  it("personalBest and newRecord count 兔了个兔 runs only", async () => {
    await createDefaultProducts();
    await insertRun({ wechatId: "wx_alice", score: 100_000, game: "BIG" });
    const run = await start("wx_alice");
    const bot = play(run);
    const res = await finishTuRun(db, { runId: run.runId, taps: bot.taps }, IP, LATER);
    expect(res).toMatchObject({ personalBest: bot.score, newRecord: true, rank: 1 });
    const run2 = await start("wx_bob", "Bob");
    const bot2 = play(run2, 3);
    const res2 = await finishTuRun(db, { runId: run2.runId, taps: bot2.taps }, IP, LATER);
    expect(res2).toMatchObject({ newRecord: false, rank: 2 });
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

  it("start -> finish -> leaderboard end to end; game 1's board stays empty", async () => {
    await createDefaultProducts();
    const sres = await startPOST(jsonRequest("/api/game/tu/start", { wechatId: "wx_route", nickname: "Rou" }, { "x-forwarded-for": "1.2.3.4" }));
    expect(sres.status).toBe(201);
    expect(sres.headers.get("cache-control")).toBe("no-store");
    const run = await sres.json();
    expect(run.tiers.some((t: { id: string }) => t.id === "big")).toBe(false);
    const bot = play(run);
    vi.setSystemTime(LATER);
    const fres = await finishPOST(jsonRequest("/api/game/tu/finish", { runId: run.runId, taps: bot.taps }, { "x-forwarded-for": "1.2.3.4" }));
    expect(fres.status).toBe(200);
    expect(await fres.json()).toMatchObject({ score: bot.score, best: bot.score, rank: 1, personalBest: bot.score, newRecord: true });
    const lres = await leaderboardGET(getRequest("/api/game/tu/leaderboard?wechatId=wx_route"));
    expect(lres.headers.get("cache-control")).toBe("no-store");
    const board = await lres.json();
    expect(Object.keys(board).sort()).toEqual(["allTime", "lastWinner", "myBest", "top", "week"]);
    expect(board.top[0]).toEqual({ rank: 1, nickname: "Rou", wechatMasked: "wx***te", score: bot.score });
    expect(board.allTime).toEqual({ nickname: "Rou", wechatMasked: "wx***te", score: bot.score });
    expect(board.myBest).toBe(bot.score);
    const viaHeader = await (await leaderboardGET(getRequest("/api/game/tu/leaderboard", { "x-game-wechat": "wx_route" }))).json();
    expect(viaHeader.myBest).toBe(bot.score);
    const big = await (await bigLeaderboardGET(getRequest("/api/game/leaderboard"))).json();
    expect(big.top).toEqual([]);
    expect(big.allTime).toBeNull();
    // A 兔了个兔 run id is unknown to game 1's finish.
    expect((await bigFinishPOST(jsonRequest("/api/game/finish", { runId: run.runId, drops: [] }))).status).toBe(404);
  });

  it("a full-length tap log fits the body limit; JSON content type and object shape are required", async () => {
    const full = Array.from({ length: MAX_TAPS }, (_, i) => ({ id: 1000 + i, at: 100_000 + i * 1000 }));
    const res = await finishPOST(jsonRequest("/api/game/tu/finish", { runId: crypto.randomUUID(), taps: full }));
    expect(res.status).toBe(404); // read and parsed; the run does not exist
    const huge = jsonRequest("/api/game/tu/finish", { runId: crypto.randomUUID(), taps: [], pad: "x".repeat(100_000) });
    expect((await finishPOST(huge)).status).toBe(422);
    expect((await startPOST(jsonRequest("/api/game/tu/start", "[]"))).status).toBe(422);
    const plain = new Request("http://localhost:3111/api/game/tu/start", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ wechatId: "a", nickname: "b" }),
    });
    expect((await startPOST(plain)).status).toBe(422);
  });

  it("start with one bread tier answers 422 with the Chinese message", async () => {
    await db.product.create({ data: { name: "唯一", unitPriceCents: 100, capacityMode: "INDEPENDENT", dailyLimit: 5, description: "" } });
    const res = await startPOST(jsonRequest("/api/game/tu/start", { wechatId: "wx", nickname: "A" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "VALIDATION", message: "兔了个兔还没准备好，请稍后再来" });
  });

  it("the raw ip never reaches the database", async () => {
    const res = await startPOST(jsonRequest("/api/game/tu/start", { wechatId: "wx_ip", nickname: "I" }, { "x-forwarded-for": "9.9.9.9" }));
    const { runId } = await res.json();
    const row = await db.gameRun.findUniqueOrThrow({ where: { id: runId } });
    expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("9.9.9.9");
  });
});

describe("cleanup", () => {
  it("drops unfinished 兔了个兔 runs of past weeks and clears IP hashes after 24 h, like game 1", async () => {
    const lastWeek = new Date("2026-10-19T04:59:59Z");
    const old = new Date(T.getTime() - 25 * 3_600_000);
    const mk = (finishedAt: Date | null, startedAt: Date) =>
      db.gameRun.create({
        data: { game: "TU", seed: "s", wechatId: "w", nickname: "n", tiersSnapshot: [], startedAt, finishedAt, score: finishedAt ? 1 : null, ipHash: "h" },
      });
    const stale = await mk(null, lastWeek);
    const resumable = await mk(null, old);
    const done = await mk(old, old);
    await cleanup(db, T);
    expect(await db.gameRun.findUnique({ where: { id: stale.id } })).toBeNull();
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: resumable.id } })).ipHash).toBeNull();
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: done.id } })).ipHash).toBeNull();
  });
});

describe("bots", () => {
  it("a random tapper's run verifies too", async () => {
    await createDefaultProducts();
    const run = await start();
    const bot = randomTu(run.seed, run.tiers);
    expect((await finishTuRun(db, { runId: run.runId, taps: bot.taps }, IP, LATER)).score).toBe(bot.score);
  });
});
