// S9: each weekly level attempt is replayed and ranked by verified passes only.
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), connection: async () => {} }));
import { POST as startPOST } from "@/app/api/game/m3/start/route";
import { POST as finishPOST } from "@/app/api/game/m3/finish/route";
import { GET as boardGET } from "@/app/api/game/m3/leaderboard/route";
import { copy } from "@/copy";
import { m3Level, m3LevelWitness, replayM3, MAX_MOVES, type M3Move } from "@/lib/m3";
import { prisma } from "@/server/db";
import { finishM3Run, getM3Leaderboard, startM3Run, M3_MAX_FINISH_BODY_BYTES } from "@/server/m3";
import { getLeaderboard, rankedWeek, FINISH_LIMIT_PER_HOUR, START_LIMIT_PER_HOUR } from "@/server/game";
import { nextGameLevel } from "@/server/gameLevels";
import { progressRun } from "@/server/gameProgress";
import { getGameHub } from "@/server/gameHub";
import { runExpiresAt } from "@/server/gameWeek";
import { randomM3 } from "../support/m3Bot";
import { jsonRequest, getRequest } from "./api.helpers";
import { db, resetDb } from "./helpers";

const T = new Date("2026-10-20T12:00:00Z"), LATER = new Date(+T + 60_000), WEEK = "2026-10-19";
const start = (wechatId = "alice", level?: number, now = T) => startM3Run(db, { wechatId, nickname: wechatId.slice(0, 10), level }, "ip", now);
const win = (run: Awaited<ReturnType<typeof start>>) => m3LevelWitness(run)!;
const finish = (run: Awaited<ReturnType<typeof start>>, moves = win(run), now = LATER) => finishM3Run(db, { runId: run.runId, moves }, "ip", now);

beforeEach(async () => {
  await resetDb();
  await db.gameTier.createMany({ data: Array.from({ length: 6 }, (_, sortOrder) => ({ name: `Bread ${sortOrder}`, sortOrder })) });
  process.env.IP_HASH_SECRET = "test-secret";
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
afterAll(async () => { await db.$disconnect(); await prisma.$disconnect(); });

it("deals the same weekly level to everyone, snapshots only its kinds, and gates N on the same identity's N-1", async () => {
  const a = await start(" alice ", 1), b = await start("bob", 1);
  expect(a).toMatchObject({ ...m3Level(WEEK, 1), level: 1, weekKey: WEEK });
  expect(a.tiers).toHaveLength(4);
  expect(b.seed).toBe(a.seed);
  expect(b.runId).not.toBe(a.runId);
  await expect(start("ALICE", 2)).rejects.toMatchObject({ message: copy.gameApi.levelLocked });
  await finish(a);
  expect((await start("ALICE")).level).toBe(2);
  await expect(start("bob", 2)).rejects.toMatchObject({ message: copy.gameApi.levelLocked });
  await expect(start("alice", 3)).rejects.toMatchObject({ message: copy.gameApi.levelLocked });
  expect((await start("alice", 1)).seed).toBe(a.seed); // unlimited retry, no consumption
  const nextWeek = new Date("2026-10-26T05:00:00Z");
  expect((await start("alice", undefined, nextWeek)).level).toBe(1);
  await expect(start("alice", 2, nextWeek)).rejects.toMatchObject({ message: copy.gameApi.levelLocked });
  expect((await getM3Leaderboard(db, nextWeek, "alice")).nextLevel).toBe(1);
});

it("replays a pass, stores evidence, ignores forged scores and rejects premature/extra moves", async () => {
  const r = await start(), moves = win(r);
  await expect(finish(r, [])).rejects.toMatchObject({ message: copy.gameApi.badRun });
  await expect(finish(r, [...moves, { ...moves[0], at: 60_000 }])).rejects.toMatchObject({ code: "VALIDATION" });
  const outcome = replayM3(r.seed, r.tiers, moves, r);
  const res = await finishM3Run(db, { runId: r.runId, moves, score: 999999, wechatId: "mallory" }, "ip", LATER);
  expect(res).toMatchObject({ score: outcome.score, passed: true, level: 1, best: 1, personalBest: 1, rank: 1, newRecord: true });
  expect(await db.gameRun.findUniqueOrThrow({ where: { id: r.runId } })).toMatchObject({
    level: 1, score: outcome.score, drops: moves, dropCount: moves.length, playMs: moves.at(-1)!.at,
    passedAt: LATER, finishedAt: LATER, weekKey: WEEK, suspicious: false,
  });
  expect(outcome.moves).toBeLessThanOrEqual(r.moves);
  expect(await nextGameLevel(db, "M3", WEEK, "mallory")).toBe(1);
  expect(await nextGameLevel(db, "M3", WEEK, "alice")).toBe(2);
});

it("stores a failed full attempt without unlocking or ranking it, and allows unlimited fresh retries", async () => {
  const r = await start();
  // Find a deterministic losing legal path (casual bot varies only its visible move choices).
  const { createM3Game, legalM3Moves } = await import("@/lib/m3");
  const { createRng } = await import("@/lib/game/rng");
  let failed: M3Move[] | undefined;
  for (let i = 0; i < 100 && !failed; i++) {
    const g = createM3Game({ ...r, tiers: r.tiers });
    const rng = createRng(`failure:${i}`), log: M3Move[] = [];
    while (!g.over) {
      const legal = legalM3Moves(g.state()), move = legal[rng.int(legal.length)];
      g.swap(move.a, move.b); log.push({ ...move, at: log.length * 500 });
    }
    if (g.score < r.target) failed = log;
  }
  expect(failed).toBeDefined();
  expect(failed).toHaveLength(r.moves);
  expect(await finish(r, failed!)).toMatchObject({ passed: false, rank: null, best: 0, personalBest: 0 });
  expect((await getM3Leaderboard(db, T, "alice")).top).toEqual([]);
  await expect(start("alice", 2)).rejects.toMatchObject({ message: copy.gameApi.levelLocked });
  const retry = await start();
  expect(retry.seed).toBe(r.seed);
  expect(retry.runId).not.toBe(r.runId);
  expect(await finish(retry)).toMatchObject({ passed: true });
});

it("claims simultaneous finishes exactly once and preserves the earliest server pass time", async () => {
  const r = await start();
  const firstLog = win(r), secondLog = randomM3(r.seed, r.tiers, r).moves;
  const [a, b] = await Promise.all([finish(r, firstLog), finish(r, secondLog)]);
  expect(a).toEqual(b);
  expect(await finish(r, [], new Date(+LATER + 10000))).toEqual(a);
  const stored = await db.gameRun.findUniqueOrThrow({ where: { id: r.runId } });
  expect(stored.finishedAt).toEqual(LATER);
  expect(stored.passedAt).toEqual(a.passed ? LATER : null);
  expect([firstLog, secondLog]).toContainEqual(stored.drops);
});

it("uses level then earliest pass time, never raw score/start/progress, with literal case-insensitive identity", async () => {
  const row = (wechatId: string, level: number, score: number, seconds: number, extra = {}) => db.gameRun.create({ data: {
    game: "M3", seed: "fixture", tiersSnapshot: [], nickname: wechatId, wechatId, level, score,
    weekKey: WEEK, startedAt: T, finishedAt: new Date(+T + seconds * 1000), passedAt: new Date(+T + seconds * 1000), ...extra,
  } });
  await row("bob", 2, 100000, 5);
  await row("alice", 3, 1000, 30);
  await row("ALICE", 3, 20000, 40);
  await row("carl", 3, 500, 20);
  await row("a_ice", 1, 100000, 10);
  await row("hidden", 20, 200, 1, { hidden: true });
  await row("banned", 30, 300, 1);
  await db.gameBan.create({ data: { wechatId: "BANNED" } });
  await row("fail", 99, 999999, 1, { passedAt: null });
  await row("legacy", 100, 999999, 1, { passedAt: null, level: null });
  await row("other", 99, 999999, 1, { game: "TU" });
  const board = await getM3Leaderboard(db, LATER, "ALICE");
  expect(board.top.map(r => [r.nickname, r.score])).toEqual([["carl", 3], ["alice", 3], ["bob", 2], ["a_ice", 1]]);
  expect(board).toMatchObject({ myBest: 3, nextLevel: 4, allTime: { nickname: "carl", score: 3 } });
  expect(await nextGameLevel(db, "M3", WEEK, "a%ice")).toBe(1);
  expect((await rankedWeek(db, WEEK, "M3"))[0].nickname).toBe("carl");
});

it("live progress keeps the score but cannot unlock or claim a level; activity survives on the passed-level board", async () => {
  const r = await start();
  await progressRun(db, "M3", { runId: r.runId, log: win(r).slice(0, 1) }, LATER);
  expect((await getM3Leaderboard(db, LATER)).top).toEqual([]);
  await expect(start("alice", 2)).rejects.toMatchObject({ message: copy.gameApi.levelLocked });
  await finish(r);
  const second = await start("ALICE", 2, LATER);
  const at = new Date(+LATER + 10000);
  await progressRun(db, "M3", { runId: second.runId, log: win(second).slice(0, 1) }, at);
  expect((await getM3Leaderboard(db, at)).top[0]).toMatchObject({ score: 1, live: true });
  expect((await getGameHub(db, at)).games.find(g => g.kind === "M3")).toMatchObject({ weekBest: 1, live: true });
  vi.stubEnv("LIVE_SCORES", "off");
  expect((await getM3Leaderboard(db, at)).top[0]).toMatchObject({ score: 1, live: false });
});

it("rejects v2, wrong level seed, expired attempts, forged identity, malformed logs and implausible time", async () => {
  const r = await start();
  await expect(finishM3Run(db, { runId: crypto.randomUUID(), moves: [] }, "ip", LATER)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await db.gameRun.update({ where: { id: r.runId }, data: { seed: "v2.abcdef" } });
  await expect(finish(r)).rejects.toMatchObject({ message: copy.gameApi.runExpired });
  await expect(progressRun(db, "M3", { runId: r.runId, log: [] }, LATER)).rejects.toMatchObject({ message: copy.gameApi.runExpired });
  await db.gameRun.update({ where: { id: r.runId }, data: { seed: m3Level(WEEK, 2).seed } });
  await expect(finish(r)).rejects.toMatchObject({ code: "VALIDATION" });
  await db.gameRun.update({ where: { id: r.runId }, data: { seed: r.seed } });
  const moves = win(r);
  for (const log of [[{ ...moves[0], b: moves[0].a }], moves.map((m, i) => ({ ...m, at: i })),
    moves.map(m => ({ ...m, at: m.at + 1_000_000 })), [{ ...moves[0], at: -1 }]]) {
    await expect(finish(r, log)).rejects.toMatchObject({ code: "VALIDATION" });
  }
  await expect(finish(r, moves, runExpiresAt(T))).rejects.toMatchObject({ message: copy.gameApi.runExpired });
  await db.gameBan.create({ data: { wechatId: "ALICE" } });
  await expect(finish(r)).rejects.toMatchObject({ message: copy.gameApi.banned });
  await expect(start()).rejects.toMatchObject({ message: copy.gameApi.banned });
});

it("keeps readiness, identity validation, route body limits and separate start/finish throttles", async () => {
  for (const input of [{ wechatId: "", nickname: "a" }, { wechatId: "a", nickname: "" }, { wechatId: "a", nickname: "a", level: 0 }]) {
    await expect(startM3Run(db, input, "ip", T)).rejects.toMatchObject({ code: "VALIDATION" });
  }
  const r = await start();
  await db.rateLimitHit.createMany({ data: Array.from({ length: START_LIMIT_PER_HOUR }, () => ({ key: "m3_start_ip:ip", at: T })) });
  await expect(start()).rejects.toMatchObject({ code: "RATE_LIMITED" });
  await finish(r);
  await db.rateLimitHit.createMany({ data: Array.from({ length: FINISH_LIMIT_PER_HOUR }, () => ({ key: "m3_finish_ip:ip", at: T })) });
  await expect(finish(r)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  expect((await finishPOST(jsonRequest("/api/game/m3/finish", { runId: r.runId, moves: Array(MAX_MOVES + 1).fill(win(r)[0]) }))).status).toBe(422);
  expect((await finishPOST(jsonRequest("/api/game/m3/finish", { padding: "x".repeat(M3_MAX_FINISH_BODY_BYTES) }))).status).toBe(422);
  await db.gameTier.deleteMany();
  await expect(startM3Run(db, { wechatId: "a", nickname: "a" }, "fresh", T)).rejects.toMatchObject({ message: copy.gameApi.m3NotReady });
});

it("routes return level metadata, replay results, masked board and hashed IP; suspicious passes still rank", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T);
  const res = await startPOST(jsonRequest("/api/game/m3/start", { wechatId: "wx_route", nickname: "Route", level: 1 }, { "x-forwarded-for": "1.2.3.4" }));
  expect(res.status).toBe(201); expect(res.headers.get("cache-control")).toBe("no-store");
  const run = await res.json();
  const moves = win(run).map((m, i) => ({ ...m, at: i * 200 }));
  vi.setSystemTime(LATER);
  const done = await finishPOST(jsonRequest("/api/game/m3/finish", { runId: run.runId, moves }));
  expect(done.status).toBe(200); expect(await done.json()).toMatchObject({ passed: true, level: 1, best: 1 });
  const stored = await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } });
  expect(stored.ipHash).toMatch(/^[a-f0-9]{64}$/); expect(stored.suspicious).toBe(true);
  const board = await (await boardGET(getRequest("/api/game/m3/leaderboard?wechatId=WX_ROUTE"))).json();
  expect(board).toMatchObject({ nextLevel: 2, myBest: 1, top: [{ score: 1, wechatMasked: "wx***te" }] });
  expect((await getLeaderboard(db, T)).top).toEqual([]);
});

it("replays saved tier snapshots after configuration changes and accepts casual completed attempts", async () => {
  const r = await start();
  await db.gameTier.deleteMany();
  const bot = randomM3(r.seed, r.tiers, r);
  expect(await finish(r, bot.moves)).toMatchObject({ score: bot.score, passed: bot.score >= r.target });
});
