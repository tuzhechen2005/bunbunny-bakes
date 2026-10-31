// 兔兔三连烤 server (S2, D135): start, finish (replay + plausibility + suspicious flag),
// weekly board, all-time record, separation from 消除大面包, routes, cleanup.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
import { GET as bigLeaderboardGET } from "@/app/api/game/leaderboard/route";
import { POST as bigFinishPOST } from "@/app/api/game/finish/route";
import { GET as leaderboardGET } from "@/app/api/game/m3/leaderboard/route";
import { POST as finishPOST } from "@/app/api/game/m3/finish/route";
import { POST as startPOST } from "@/app/api/game/m3/start/route";
import { MAX_MOVES, MIN_MOVE_GAP_MS, createM3Game, immediateM3Score, replayM3, m3Seed, M3_ENGINE_VERSION } from "@/lib/m3";
import { prisma } from "@/server/db";
import { finishRun, getLeaderboard, PLAUSIBILITY_SLACK_MS, FINISH_LIMIT_PER_HOUR, START_LIMIT_PER_HOUR, startRun } from "@/server/game";
import { copy } from "@/copy";
import { getGameHub } from "@/server/gameHub";
import { finishTuRun, startTuRun, getTuLeaderboard } from "@/server/tu";
import { cleanup } from "@/server/maintenance";
import { finishM3Run, getM3Leaderboard, startM3Run, M3_MAX_FINISH_BODY_BYTES } from "@/server/m3";
import { greedyM3, randomM3 } from "../support/m3Bot";
import { getRequest, jsonRequest, NOW } from "./api.helpers";
import { createDefaultProducts, db, resetDb } from "./helpers";

process.env.IP_HASH_SECRET = "test-secret";

const IP = "iphash-a";
const T = NOW; // Tue 2026-10-20, week of Monday 2026-10-19 (Chicago)
const WEEK = "2026-10-19";
// Allow a full log at the bot's maximum 1050 ms gap.
const LATER = new Date(T.getTime() + MAX_MOVES * 1050 + 1000);

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
});

async function createM3Tiers() {
  const ids = await createDefaultProducts();
  await db.product.createMany({ data: [5, 6, 7].map((n) => ({
    name: `Bread ${n}`, sortOrder: n, unitPriceCents: 100, capacityMode: "INDEPENDENT" as const,
    dailyLimit: 5, description: "",
  })) });
  return ids;
}

async function start(wechatId = "wx_alice", nickname = "Alice", ip = IP, now = T) {
  return startM3Run(db, { wechatId, nickname }, ip, now);
}

/** A greedy bot game on the run's own seed and tiers (gaps 150-1050 ms). */
function play(run: Awaited<ReturnType<typeof start>>, maxMoves = MAX_MOVES) {
  const bot = greedyM3(run.seed, run.tiers);
  const moves = bot.moves.slice(0, maxMoves);
  return { ...bot, score: replayM3(run.seed, run.tiers, moves).score, moves };
}

async function insertRun(o: {
  wechatId: string;
  nickname?: string;
  score: number;
  finishedAt?: Date;
  weekKey?: string;
  hidden?: boolean;
  game?: "BIG" | "TU" | "M3";
}) {
  return db.gameRun.create({
    data: {
      game: o.game ?? "M3",
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

describe("finish contracts", () => {
  it("is idempotent, and concurrent duplicates store one result", async () => {
    await createM3Tiers();
    const run = await start();
    const bot = play(run);
    const [a, b] = await Promise.all([
      finishM3Run(db, { runId: run.runId, moves: bot.moves }, IP, LATER),
      finishM3Run(db, { runId: run.runId, moves: bot.moves }, IP, LATER),
    ]);
    expect(a).toEqual(b);
    const again = await finishM3Run(db, { runId: run.runId, moves: bot.moves.slice(0, 3) }, IP, new Date(LATER.getTime() + 1000));
    expect(again.score).toBe(bot.score);
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } })).finishedAt).toEqual(LATER);
  });

  it("concurrent different logs cannot overwrite the first claim", async () => {
    await createM3Tiers();
    const run = await start();
    const bot = play(run);
    const [a, b] = await Promise.all([
      finishM3Run(db, { runId: run.runId, moves: bot.moves }, IP, LATER),
      finishM3Run(db, { runId: run.runId, moves: [] }, IP, LATER),
    ]);
    const stored = await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } });
    expect(a).toEqual(b);
    expect(a.score).toBe(stored.score);
    expect([0, bot.score]).toContain(stored.score);
    expect(stored.drops).toEqual(stored.score === 0 ? [] : bot.moves);
  });

  it("NOT_FOUND for an unknown run and for a run of the other game (both ways)", async () => {
    await createM3Tiers();
    await expect(finishM3Run(db, { runId: crypto.randomUUID(), moves: [] }, IP, LATER)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const big = await startRun(db, { wechatId: "wx", nickname: "A" }, IP, T);
    await expect(finishM3Run(db, { runId: big.runId, moves: [] }, IP, LATER)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const tu = await startTuRun(db, { wechatId: "wx", nickname: "A" }, IP, T);
    await expect(finishM3Run(db, { runId: tu.runId, moves: [] }, IP, LATER)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const m3 = await start();
    await expect(finishTuRun(db, { runId: m3.runId, taps: [] }, IP, LATER)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(finishRun(db, { runId: m3.runId, drops: [] }, IP, LATER)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(finishM3Run(db, { runId: "nope", moves: [] }, IP, LATER)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it(`rejects two moves closer than ${MIN_MOVE_GAP_MS} ms; exactly ${MIN_MOVE_GAP_MS} is fine`, async () => {
    await createM3Tiers();
    const run = await start();
    const { moves } = play(run, 10);
    const spaced = (gap: number) => moves.map((t, i) => ({ ...t, at: 1000 + i * gap }));
    const tooFast = spaced(MIN_MOVE_GAP_MS).map((t, i) => (i === 5 ? { ...t, at: t.at - 1 } : t));
    await expect(finishM3Run(db, { runId: run.runId, moves: tooFast }, IP, LATER)).rejects.toMatchObject({
      code: "VALIDATION",
      message: "这一局的成绩没能通过验证",
    });
    await expect(finishM3Run(db, { runId: run.runId, moves: spaced(MIN_MOVE_GAP_MS) }, IP, LATER)).resolves.toBeDefined();
  });

  it("rejects a last move later than the real time since start plus slack", async () => {
    await createM3Tiers();
    const run = await start();
    const { moves } = play(run, 10);
    const lastAt = moves[moves.length - 1].at;
    const early = new Date(T.getTime() + lastAt - PLAUSIBILITY_SLACK_MS - 1);
    await expect(finishM3Run(db, { runId: run.runId, moves }, IP, early)).rejects.toMatchObject({ code: "VALIDATION" });
    const ok = new Date(T.getTime() + lastAt - PLAUSIBILITY_SLACK_MS);
    await expect(finishM3Run(db, { runId: run.runId, moves }, IP, ok)).resolves.toBeDefined();
  });

  it("a run lives until the weekly reset after its start (exclusive)", async () => {
    await createM3Tiers();
    const sunday = new Date("2026-10-26T04:30:00Z");
    const run = await start("wx_sun", "Sun", IP, sunday);
    const { moves } = play(run, 6);
    await expect(finishM3Run(db, { runId: run.runId, moves }, IP, new Date("2026-10-26T05:00:00Z"))).rejects.toMatchObject({
      code: "VALIDATION",
      message: "这一局已经过期，请重新开始",
    });
    expect((await finishM3Run(db, { runId: run.runId, moves }, IP, new Date("2026-10-26T04:59:00Z"))).week.start).toBe(WEEK);
  });

  it("refuses to finish a run whose wechat id got banned meanwhile", async () => {
    await createM3Tiers();
    const run = await start("wx_x");
    await db.gameBan.create({ data: { wechatId: "WX_X" } });
    await expect(finishM3Run(db, { runId: run.runId, moves: play(run, 3).moves }, IP, LATER)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("uses the tier snapshot from start, not today's tiers", async () => {
    const ids = await createM3Tiers();
    const run = await start();
    const bot = play(run);
    await db.product.update({ where: { id: ids.rockCheese }, data: { status: "PAUSED" } });
    expect((await finishM3Run(db, { runId: run.runId, moves: bot.moves }, IP, LATER)).score).toBe(bot.score);
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
    const board = await getM3Leaderboard(db, T, "wx_ali");
    expect(board.top.map((r) => [r.rank, r.wechatMasked, r.score])).toEqual([
      [1, "wx***ob", 500],
      [2, "WX***LI", 500],
    ]);
    expect(board.myBest).toBe(500);
    expect(board.lastWinner).toMatchObject({ score: 9999 });
    expect(board.allTime).toMatchObject({ score: 9999 });
  });

  it("the three games never mix: boards, all-time record, personalBest, lastWinner awards", async () => {
    await insertRun({ wechatId: "wx_big", score: 5000, game: "BIG" });
    await insertRun({ wechatId: "wx_tu", score: 6000, game: "TU" });
    await insertRun({ wechatId: "wx_m3", score: 40, game: "M3" });
    await insertRun({ wechatId: "wx_lastbig", score: 7, game: "BIG", weekKey: "2026-10-12", finishedAt: new Date("2026-10-14T12:00:00Z") });
    const lastM3 = await insertRun({ wechatId: "wx_lastm3", score: 3, game: "M3", weekKey: "2026-10-12", finishedAt: new Date("2026-10-14T12:00:00Z") });
    const m3 = await getM3Leaderboard(db, T, "wx_big");
    expect(m3.top.map((r) => r.score)).toEqual([40]);
    expect(m3.allTime?.score).toBe(40);
    expect(m3.lastWinner?.score).toBe(3);
    expect(m3.myBest).toBeUndefined();
    const big = await getLeaderboard(db, T, "wx_m3");
    expect(big.top.map((r) => r.score)).toEqual([5000]);
    expect(big.allTime?.score).toBe(5000);
    expect(big.lastWinner?.score).toBe(7);
    expect(big.myBest).toBeUndefined();
    const tu = await getTuLeaderboard(db, T, "wx_m3");
    expect(tu.top.map((r) => r.score)).toEqual([6000]);
    expect(tu.myBest).toBeUndefined();
    // A 兔兔三连烤 award for last week names its winner on its own board only (same week as no game-1 award).
    await db.gameAward.create({ data: { game: "M3", weekKey: "2026-10-12", runId: lastM3.id } });
    expect((await getLeaderboard(db, T)).lastWinner?.score).toBe(7);
    expect((await getM3Leaderboard(db, T)).lastWinner?.score).toBe(3);
  });

  it("personalBest and newRecord count 兔兔三连烤 runs only", async () => {
    await createM3Tiers();
    await insertRun({ wechatId: "wx_alice", score: 100_000, game: "BIG" });
    const run = await start("wx_alice");
    const bot = play(run);
    const res = await finishM3Run(db, { runId: run.runId, moves: bot.moves }, IP, LATER);
    expect(res).toMatchObject({ personalBest: bot.score, newRecord: true, rank: 1 });
    const run2 = await start("wx_bob", "Bob");
    await db.gameRun.update({ where: { id: run2.runId }, data: { seed: run.seed } });
    const bot2 = play({ ...run2, seed: run.seed }, 3);
    const res2 = await finishM3Run(db, { runId: run2.runId, moves: bot2.moves }, IP, LATER);
    expect(res2).toMatchObject({ newRecord: false, rank: 2 });
  });
});

describe("routes", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("start -> finish -> leaderboard end to end; game 1's board stays empty", async () => {
    await createM3Tiers();
    const sres = await startPOST(jsonRequest("/api/game/m3/start", { wechatId: "wx_route", nickname: "Rou" }, { "x-forwarded-for": "1.2.3.4" }));
    expect(sres.status).toBe(201);
    expect(sres.headers.get("cache-control")).toBe("no-store");
    const run = await sres.json();
    expect(run.tiers.some((t: { id: string }) => t.id === "big")).toBe(false);
    const bot = play(run);
    vi.setSystemTime(LATER);
    const fres = await finishPOST(jsonRequest("/api/game/m3/finish", { runId: run.runId, moves: bot.moves }, { "x-forwarded-for": "1.2.3.4" }));
    expect(fres.status).toBe(200);
    expect(await fres.json()).toMatchObject({ score: bot.score, best: bot.score, rank: 1, personalBest: bot.score, newRecord: true });
    const lres = await leaderboardGET(getRequest("/api/game/m3/leaderboard?wechatId=wx_route"));
    expect(lres.headers.get("cache-control")).toBe("no-store");
    const board = await lres.json();
    expect(Object.keys(board).sort()).toEqual(["allTime", "lastWinner", "liveScores", "myBest", "top", "week"]);
    expect(board.top[0]).toEqual({ live: false, rank: 1, nickname: "Rou", wechatMasked: "wx***te", score: bot.score });
    expect(board.allTime).toEqual({ nickname: "Rou", wechatMasked: "wx***te", score: bot.score });
    expect(board.myBest).toBe(bot.score);
    const viaHeader = await (await leaderboardGET(getRequest("/api/game/m3/leaderboard", { "x-game-wechat": "wx_route" }))).json();
    expect(viaHeader.myBest).toBe(bot.score);
    const big = await (await bigLeaderboardGET(getRequest("/api/game/leaderboard"))).json();
    expect(big.top).toEqual([]);
    expect(big.allTime).toBeNull();
    // A 兔兔三连烤 run id is unknown to game 1's finish.
    expect((await bigFinishPOST(jsonRequest("/api/game/finish", { runId: run.runId, drops: [] }))).status).toBe(404);
  });

  it("the raw ip never reaches the database", async () => {
    await createM3Tiers();
    const res = await startPOST(jsonRequest("/api/game/m3/start", { wechatId: "wx_ip", nickname: "I" }, { "x-forwarded-for": "9.9.9.9" }));
    const { runId } = await res.json();
    const row = await db.gameRun.findUniqueOrThrow({ where: { id: runId } });
    expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("9.9.9.9");
  });
});

describe("cleanup", () => {
  it("drops unfinished 兔兔三连烤 runs of past weeks and clears IP hashes after 24 h, like game 1", async () => {
    const lastWeek = new Date("2026-10-19T04:59:59Z");
    const old = new Date(T.getTime() - 25 * 3_600_000);
    const mk = (finishedAt: Date | null, startedAt: Date) =>
      db.gameRun.create({
        data: { game: "M3", seed: "s", wechatId: "w", nickname: "n", tiersSnapshot: [], startedAt, finishedAt, score: finishedAt ? 1 : null, ipHash: "h" },
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
  it("a random player's run verifies too", async () => {
    await createM3Tiers();
    const run = await start();
    const bot = randomM3(run.seed, run.tiers);
    expect((await finishM3Run(db, { runId: run.runId, moves: bot.moves }, IP, LATER)).score).toBe(bot.score);
  });
});

describe("M3 start and replay", () => {
  it("pins the current version and first six BIG bread tiers in configured order", async () => {
    await createM3Tiers();
    await db.gameTier.createMany({ data: [7, 2, 5, 0, 6, 1, 4, 3].map((n) => ({ name: `Piece ${n}`, sortOrder: n })) });
    await db.gameTier.create({ data: { isBig: true, sortOrder: -1 } });
    const expected = await db.gameTier.findMany({ where: { isBig: false }, orderBy: { sortOrder: "asc" }, take: 6 });
    const r = await start();
    expect(Object.keys(r).sort()).toEqual(["expiresAt", "runId", "seed", "tiers"]);
    expect((await start("wx_second")).seed).not.toBe(r.seed);
    expect(r.seed).toMatch(new RegExp(`^v${M3_ENGINE_VERSION}\\.[0-9a-f]{32}$`));
    expect(r.expiresAt).toBe("2026-10-26T05:00:00.000Z");
    expect(r.tiers.map((t) => t.id)).toEqual(expected.map((t) => t.id));
    const big = await startRun(db, { wechatId: "wx_b", nickname: "B" }, IP, T);
    expect(r.tiers).toEqual(big.tiers.slice(0, 6));
    const stored = await db.gameRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(stored).toMatchObject({ game: "M3", ipHash: IP, finishedAt: null, tiersSnapshot: r.tiers });
    const bot = play(r);
    await db.gameTier.deleteMany();
    await db.product.updateMany({ data: { status: "PAUSED" } });
    await expect(start()).rejects.toMatchObject({ message: copy.gameApi.m3NotReady });
    expect((await finishM3Run(db, { runId: r.runId, moves: bot.moves }, IP, LATER)).score).toBe(bot.score);
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: r.runId } })).tiersSnapshot).toEqual(stored.tiersSnapshot);
  });

  it.each([0, 1, 4, 5])("returns an unavailable validation error with %i bread tiers", async (n) => {
    await db.gameTier.createMany({ data: Array.from({ length: n }, (_, i) => ({ name: `Bread ${i}`, sortOrder: i })) });
    const response = await startPOST(jsonRequest("/api/game/m3/start", { wechatId: "wx", nickname: "A" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "VALIDATION", message: copy.gameApi.m3NotReady });
    expect(await db.gameRun.count()).toBe(0);
  });

  it("shares identity validation and bans, and keeps start/finish rate limits separate", async () => {
    await createM3Tiers();
    for (const [w, n] of [["", "A"], ["wx", ""], ["x".repeat(65), "A"], ["wx", "A".repeat(13)]]) {
      await expect(start(w, n)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await db.gameBan.create({ data: { wechatId: "WX_BAD" } });
    await expect(start("wx_bad")).rejects.toMatchObject({ message: copy.gameApi.banned });
    await db.rateLimitHit.createMany({ data: Array.from({ length: START_LIMIT_PER_HOUR }, () => ({ key: `tu_start_ip:${IP}`, at: T })) });
    const r = await start(" wx_ok ", " A ");
    expect(await db.gameRun.findUnique({ where: { id: r.runId } })).toMatchObject({ wechatId: "wx_ok", nickname: "A" });
    await db.rateLimitHit.createMany({ data: Array.from({ length: START_LIMIT_PER_HOUR }, () => ({ key: `m3_start_ip:${IP}`, at: T })) });
    await expect(start()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(start("wx", "A", "other")).resolves.toBeDefined();
    await db.rateLimitHit.createMany({ data: Array.from({ length: FINISH_LIMIT_PER_HOUR }, () => ({ key: `m3_finish_ip:${IP}`, at: T })) });
    await expect(finishM3Run(db, { runId: r.runId, moves: [] }, IP, LATER)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(finishM3Run(db, { runId: r.runId, moves: [] }, "other", LATER)).resolves.toMatchObject({ score: 0 });
  });

  it.each([0, 4, MAX_MOVES])("replays %i moves, ignores client score, and stores evidence", async (count) => {
    await createM3Tiers();
    const r = await start();
    const bot = play(r, count);
    const moves = bot.moves.map((m, i) => ({ ...m, at: i * 500 }));
    const result = await finishM3Run(db, { runId: r.runId, moves, score: 999_999 }, IP, LATER);
    expect(result).toMatchObject({ score: bot.score, best: bot.score, personalBest: bot.score, newRecord: true, rank: 1 });
    expect(await db.gameRun.findUnique({ where: { id: r.runId } })).toMatchObject({
      drops: moves, dropCount: count, playMs: moves.at(-1)?.at ?? 0, simSteps: null,
      suspicious: false, weekKey: WEEK, finishedAt: LATER, score: bot.score,
    });
  });

  it("rejects missing, old and future seed versions before replay", async () => {
    await createM3Tiers();
    const r = await start();
    for (const seed of ["abcdef", "v0.abcdef", "v1.abcdef", `v${M3_ENGINE_VERSION + 1}.abcdef`]) {
      await db.gameRun.update({ where: { id: r.runId }, data: { seed } });
      await expect(finishM3Run(db, { runId: r.runId, moves: [] }, IP, LATER)).rejects.toMatchObject({ code: "VALIDATION", message: copy.gameApi.runExpired });
      expect((await db.gameRun.findUniqueOrThrow({ where: { id: r.runId } })).finishedAt).toBeNull();
    }
    await db.gameRun.update({ where: { id: r.runId }, data: { seed: m3Seed("abcdef") } });
    await expect(finishM3Run(db, { runId: r.runId, moves: [] }, IP, LATER)).resolves.toBeDefined();
  });

  it("maps illegal swaps and malformed moves to VALIDATION without closing the run", async () => {
    await createM3Tiers();
    const r = await start();
    const { moves } = play(r);
    const state = createM3Game({ seed: r.seed, tiers: r.tiers }).state();
    const noMatch = Array.from({ length: 56 }, (_, i) => ({
      a: { r: Math.floor(i / 7), c: i % 7 }, b: { r: Math.floor(i / 7), c: i % 7 + 1 }, at: 0,
    })).find((m) => immediateM3Score(state, m.a, m.b) === null)!;
    expect(noMatch).toBeDefined();
    const bad: unknown[] = [
      [noMatch],
      [{ a: { r: 0, c: 0 }, b: { r: 0, c: 0 }, at: 0 }],
      [{ a: { r: 0, c: 0 }, b: { r: 7, c: 7 }, at: 0 }],
      [{ ...moves[0], a: { r: -1, c: 0 } }],
      [{ ...moves[0], b: { r: 0, c: 8 } }],
      [{ ...moves[0], at: -1 }], [{ ...moves[0], at: 0.5 }],
      [{ ...moves[0], at: Number.MAX_SAFE_INTEGER + 1 }],
      [moves[0], { ...moves[1], at: 0 }], [{ ...moves[0], extra: 1 }],
      [{ a: { r: 0, c: "1" }, b: moves[0].b, at: 0 }],
      [...moves, { ...moves[0], at: 99_000 }], "moves", [null], [{}],
    ];
    for (const log of bad) {
      await expect(finishM3Run(db, { runId: r.runId, moves: log }, IP, LATER)).rejects.toMatchObject({ code: "VALIDATION" });
      expect((await db.gameRun.findUniqueOrThrow({ where: { id: r.runId } })).finishedAt).toBeNull();
    }
    expect((await finishM3Run(db, { runId: r.runId, moves }, IP, LATER)).score).toBeGreaterThan(0);
  });

  it("flags a plausible fast run and still includes it on the leaderboard", async () => {
    await createM3Tiers();
    const r = await start();
    const moves = play(r).moves.map((m, i) => ({ ...m, at: i * 200 }));
    expect((await finishM3Run(db, { runId: r.runId, moves }, IP, LATER)).rank).toBe(1);
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: r.runId } })).suspicious).toBe(true);
    expect((await getM3Leaderboard(db, LATER)).top).toHaveLength(1);
  });

  it("accepts MAX_MOVES through the route, bounds body size, and requires JSON", async () => {
    await createM3Tiers();
    const r = await start("wx_routecap", "Cap", IP, new Date(Date.now() - 60_000));
    const moves = play(r).moves;
    const body = { runId: r.runId, moves };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(M3_MAX_FINISH_BODY_BYTES);
    const post = (data: unknown) => finishPOST(jsonRequest("/api/game/m3/finish", data));
    expect((await post({ ...body, moves: [...moves, moves[0]] })).status).toBe(422);
    expect((await db.gameRun.findUniqueOrThrow({ where: { id: r.runId } })).finishedAt).toBeNull();
    expect((await post({ ...body, padding: "x".repeat(M3_MAX_FINISH_BODY_BYTES) })).status).toBe(422);
    expect((await post(body)).status).toBe(200);
    expect((await post([])).status).toBe(422);
    expect((await startPOST(new Request("http://localhost/api/game/m3/start", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }))).status).toBe(422);
  });

  it("includes M3 in the hub while the prize pool follows its launch gate", async () => {
    const hub = await getGameHub(db, T);
    expect(hub.games.map((g) => g.kind)).toEqual(["BIG", "TU", "M3", "GRAB"]);
    expect(["BIG", "TU"]).toContain(hub.prizeGame);
  });
});
