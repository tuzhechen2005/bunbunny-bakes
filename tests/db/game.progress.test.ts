import { startTuRun, finishTuRun } from "@/server/tu";
import { startM3Run, finishM3Run } from "@/server/m3";
import { replayTu } from "@/lib/tu";
import { replayM3 } from "@/lib/m3";
import { randomTu } from "../support/tuBot";
import { randomM3 } from "../support/m3Bot";
import { enqueueGameWinner } from "@/server/gameWinner";
import { getBoard, updateAward } from "@/server/gameAdmin";
import { getGameHub } from "@/server/gameHub";
import { overridePrizeGame } from "@/server/gamePrize";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { progressRun } from "@/server/gameProgress";
import { finishRun, getLeaderboard, rankedWeek, startRun } from "@/server/game";
import * as bigGame from "@/server/game";
import { cleanup } from "@/server/maintenance";
import { runExpiresAt, weekKeyOf } from "@/server/gameWeek";
import { botRun } from "../support/gameBot";
import { createDefaultProducts, db, resetDb } from "./helpers";

const start = new Date("2026-10-30T12:00:00Z");
const now = new Date("2026-10-30T13:00:00Z");
beforeEach(async () => { vi.unstubAllEnvs(); await resetDb(); await createDefaultProducts(); });
afterAll(async () => { vi.unstubAllEnvs(); await db.$disconnect(); });
it("stores and compares parsed BIG logs", async () => {
  const run = await startRun(db, { wechatId: "alice", nickname: "Alice" }, "ip", start);
  const log = [{ x: 0.5, at: 0 }];
  await progressRun(db, "BIG", { runId: run.runId, log: log.map(drop => ({ ...drop, junk: "discard" })) }, now);
  expect((await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } })).drops).toEqual(log);
  await progressRun(db, "BIG", { runId: run.runId, log: log.map(drop => ({ ...drop, junk: "different" })) }, new Date(+now + 8000));
});

it("rejects stale/diverging prefixes before replay", async () => {
  const run = await startRun(db, { wechatId: "alice", nickname: "Alice" }, "ip", start);
  await progressRun(db, "BIG", { runId: run.runId, log: [{ x: 0.5, at: 0 }] }, now);
  const replay = vi.spyOn(bigGame, "verifyBigRun");
  try {
    for (const [i, stale] of [[], [{ x: 0.6, at: 0 }]].entries()) {
      await expect(progressRun(db, "BIG", { runId: run.runId, log: stale }, new Date(+now + 16000 + i * 8000)))
        .rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(replay).not.toHaveBeenCalled();
  } finally { replay.mockRestore(); }
});

it("idle reports keep the earlier score's tie rank while renewing live status, including weekly awards", async () => {
  const run = await startRun(db, { wechatId: "alice", nickname: "Alice" }, "ip", start);
  const seed = "s5-idle-player";
  await db.gameRun.update({ where: { id: run.runId }, data: { seed } });
  const bot = botRun(seed, run.tiers, 20);
  expect(bot.score).toBeGreaterThan(0);
  await progressRun(db, "BIG", { runId: run.runId, log: [] }, now);
  const scoredAt = new Date(+now + 8000);
  const body = { runId: run.runId, log: bot.log };
  await progressRun(db, "BIG", body, scoredAt);
  const bob = await startRun(db, { wechatId: "bob", nickname: "Bob" }, "ip", start);
  await db.gameRun.update({ where: { id: bob.runId }, data: { seed } });
  await finishRun(db, { runId: bob.runId, drops: bot.log }, "ip", new Date(+now + 16000));
  const idleAt = new Date(+now + 48000);
  await progressRun(db, "BIG", body, idleAt);
  expect(await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } }))
    .toMatchObject({ updatedAt: scoredAt, progressAttemptAt: idleAt, score: bot.score });
  expect((await getLeaderboard(db, idleAt)).top.map(r => ({ nickname: r.nickname, live: r.live })))
    .toEqual([{ nickname: "Alice", live: true }, { nickname: "Bob", live: false }]);
  expect((await getLeaderboard(db, new Date(+idleAt + 30000))).top[0].live).toBe(false);
  expect((await getBoard(db, weekKeyOf(start), idleAt)).rows.map(r => r.id)).toEqual([run.runId, bob.runId]);
  expect((await getGameHub(db, idleAt)).games[0]).toMatchObject({ live: true });
  await overridePrizeGame(db, "BIG", now);
  const cutoff = runExpiresAt(start);
  await cleanup(db, cutoff);
  expect((await rankedWeek(db, weekKeyOf(start)))[0].id).toBe(run.runId);
  await enqueueGameWinner(db, cutoff);
  expect((await db.notification.findFirstOrThrow({ where: { kind: "GAME_WINNER" } })).payload)
    .toMatchObject({ winner: { wechatId: "alice", score: bot.score } });
});

it("retains old verified live and finished evidence equally, discarding only unverified runs", async () => {
  const live = await startRun(db, { wechatId: "alice", nickname: "Alice" }, "ip", start);
  const finished = await startRun(db, { wechatId: "bob", nickname: "Bob" }, "ip", start);
  const empty = await startRun(db, { wechatId: "empty", nickname: "Empty" }, "ip", start);
  const log = [{ x: 0.5, at: 0 }];
  await progressRun(db, "BIG", { runId: live.runId, log }, now);
  await finishRun(db, { runId: finished.runId, drops: log }, "ip", now);
  await updateAward(db, { week: weekKeyOf(start), contacted: true }, now);
  const later = new Date("2027-10-30T13:00:00Z");
  await cleanup(db, later);
  await cleanup(db, later);
  for (const id of [live.runId, finished.runId]) {
    expect(await db.gameRun.findUniqueOrThrow({ where: { id } })).toMatchObject({ drops: log, ipHash: null });
  }
  expect(await db.gameRun.findUnique({ where: { id: empty.runId } })).toBeNull();
  expect(await rankedWeek(db, weekKeyOf(start))).toHaveLength(2);
  expect(await db.gameAward.count()).toBe(1);
});

it("replays progress, rate limits before log validation, finishes and clears live", async () => {
  const run = await startRun(db, { wechatId: "alice", nickname: "Alice" }, "ip", start);
  const bot = botRun(run.seed, run.tiers, 12);
  const body = { runId: run.runId, log: bot.log };
  const result = await progressRun(db, "BIG", body, now);
  expect(result.score).toBe(bot.score);
  expect((await getLeaderboard(db, now)).top[0]).toMatchObject({ score: bot.score, live: true });
  await expect(progressRun(db, "BIG", { runId: run.runId, log: null }, new Date(+now + 7999))).rejects.toMatchObject({ code: "RATE_LIMITED" });
  expect((await getLeaderboard(db, new Date(+now + 30000))).top[0].live).toBe(false);
  await finishRun(db, { runId: run.runId, drops: bot.log }, "ip", new Date(+now + 8000));
  expect((await getLeaderboard(db, new Date(+now + 8000))).top[0].live).toBe(false);
});
it("finish accepts the final log inside the progress throttle window", async () => {
  const run = await startRun(db, { wechatId: "alice", nickname: "Alice" }, "ip", start);
  const bot = botRun(run.seed, run.tiers, 12);
  await progressRun(db, "BIG", { runId: run.runId, log: bot.log.slice(0, 1) }, now);
  const finishedAt = new Date(+now + 1);
  await finishRun(db, { runId: run.runId, drops: bot.log }, "ip", finishedAt);
  expect(await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } }))
    .toMatchObject({ drops: bot.log, score: bot.score, finishedAt, updatedAt: null });
});
it("retains unfinished verified scores across weekly cutoff and cleanup", async () => {
  const run = await startRun(db, { wechatId: "alice", nickname: "Alice" }, "ip", start);
  await progressRun(db, "BIG", { runId: run.runId, log: [] }, now);
  const cutoff = runExpiresAt(start);
  await expect(progressRun(db, "BIG", { runId: run.runId, log: [] }, cutoff)).rejects.toMatchObject({ code: "VALIDATION" });
  await cleanup(db, cutoff);
  expect(await rankedWeek(db, weekKeyOf(start))).toHaveLength(1);
  expect((await getLeaderboard(db, cutoff)).top).toEqual([]);
  expect((await getLeaderboard(db, cutoff)).lastWinner?.score).toBe(0);
});
it("rejects invalid replay, consumes its attempt, and turns off without accessing DB", async () => {
  const run = await startRun(db, { wechatId: "alice", nickname: "Alice" }, "ip", start);
  await expect(progressRun(db, "BIG", { runId: run.runId, log: [{ x: .5, at: 0 }, { x: .5, at: 1 }] }, now)).rejects.toMatchObject({ code: "VALIDATION" });
  expect((await getLeaderboard(db, now)).top).toEqual([]);
  await expect(progressRun(db, "BIG", { runId: run.runId, log: [] }, now)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  vi.stubEnv("LIVE_SCORES", "off");
  await expect(progressRun(db, "BIG", null, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("accepts exactly one concurrent report and never revives a finished run", async () => {
  const run = await startRun(db, { wechatId: "alice", nickname: "Alice" }, "ip", start);
  const body = { runId: run.runId, log: [] };
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => progressRun(db, "BIG", body, now)));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  for (const r of results) if (r.status === "rejected") expect(r.reason.code).toBe("RATE_LIMITED");
  await Promise.allSettled([
    progressRun(db, "BIG", body, new Date(+now + 8000)),
    finishRun(db, { runId: run.runId, drops: [] }, "ip", new Date(+now + 8000)),
  ]);
  expect(await db.gameRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({ updatedAt: null, score: 0 });
  expect((await getLeaderboard(db, new Date(+now + 8000))).top[0].live).toBe(false);
});

for (const game of ["TU", "M3"] as const) {
  it(`${game}: verifies partial logs, game separation, timing, versions, finish, bans and hidden rows`, async () => {
    await db.product.createMany({ data: [5, 6].map(n => ({ name: `Bread ${n}`, sortOrder: n,
      unitPriceCents: 100, capacityMode: "INDEPENDENT" as const, dailyLimit: 5, description: "" })) });
    const run = await (game === "TU" ? startTuRun : startM3Run)(db, { wechatId: "alice", nickname: "Alice" }, "ip", start);
    const log = game === "TU" ? randomTu(run.seed, run.tiers).taps.slice(0, 6) : randomM3(run.seed, run.tiers).moves.slice(0, 6);
    const score = game === "TU" ? replayTu(run.seed, run.tiers, log as Parameters<typeof replayTu>[2]).score
      : replayM3(run.seed, run.tiers, log as Parameters<typeof replayM3>[2]).score;
    const body = { runId: run.runId, log };
    await expect(progressRun(db, "BIG", body, now)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await progressRun(db, game, body, now)).toMatchObject({ score, live: true });
    expect((await getLeaderboard(db, now, "ALICE", game))).toMatchObject({ myBest: score, top: [{ score, live: true }] });
    // Exact min-gap boundary accepted; JSONB canonicalization must preserve the prefix.
    expect(await progressRun(db, game, body, new Date(+now + 8000))).toMatchObject({ score });
    await expect(progressRun(db, game, { ...body, log: log.slice(0, 2) }, new Date(+now + 16000))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(progressRun(db, game, { ...body, log: log.map((v, i) => ({ ...v, at: i })) }, new Date(+now + 24000))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(progressRun(db, game, { ...body, log: log.map(v => ({ ...v, at: v.at + 9_000_000 })) }, new Date(+now + 32000))).rejects.toMatchObject({ code: "VALIDATION" });
    await db.gameRun.update({ where: { id: run.runId }, data: { hidden: true } });
    expect((await getLeaderboard(db, now, null, game)).top).toEqual([]);
    await db.gameRun.update({ where: { id: run.runId }, data: { hidden: false } });
    await db.gameBan.create({ data: { wechatId: "ALICE" } });
    expect((await getLeaderboard(db, now, null, game)).top).toEqual([]);
    await expect(progressRun(db, game, body, new Date(+now + 40000))).rejects.toMatchObject({ code: "VALIDATION" });
    await db.gameBan.deleteMany();
    await (game === "TU" ? finishTuRun : finishM3Run)(db, { runId: run.runId, [game === "TU" ? "taps" : "moves"]: log }, "ip", new Date(+now + 48000));
    expect((await getLeaderboard(db, new Date(+now + 48000), null, game)).top[0]).toMatchObject({ score, live: false });
    const old = await (game === "TU" ? startTuRun : startM3Run)(db, { wechatId: "old", nickname: "Old" }, "ip", start);
    await db.gameRun.update({ where: { id: old.runId }, data: { seed: "obsolete-version" } });
    await expect(progressRun(db, game, { runId: old.runId, log: [] }, now)).rejects.toMatchObject({ code: "VALIDATION" });
  });
}

it("ranks unfinished runs with finished ones, deduplicates ids, shares hub/owner/winner ranking and stays idempotent", async () => {
  const run = await startRun(db, { wechatId: "alice", nickname: "Alice" }, "ip", start);
  const bot = botRun(run.seed, run.tiers, 20);
  await progressRun(db, "BIG", { runId: run.runId, log: bot.log }, now);
  await db.gameRun.create({ data: { seed: "s", tiersSnapshot: [], wechatId: "ALICE", nickname: "Old", startedAt: start,
    finishedAt: start, score: -1, weekKey: weekKeyOf(start) } });
  await db.gameRun.create({ data: { seed: "s", tiersSnapshot: [], wechatId: "bob", nickname: "Bob", startedAt: start,
    finishedAt: start, score: -2, weekKey: weekKeyOf(start) } });
  const rows = await rankedWeek(db, weekKeyOf(start));
  expect(rows.map(r => r.wechatId)).toEqual(["alice", "bob"]);
  expect((await getGameHub(db, now)).games[0]).toMatchObject({ weekBest: bot.score, live: true });
  expect((await getBoard(db, weekKeyOf(start), now)).winner?.runId).toBe(run.runId);
  await updateAward(db, { week: weekKeyOf(start), contacted: true }, now);
  await overridePrizeGame(db, "BIG", now);
  const cutoff = runExpiresAt(start);
  await cleanup(db, cutoff);
  const results = await Promise.all([enqueueGameWinner(db, cutoff), enqueueGameWinner(db, cutoff)]);
  expect(results.map(r => r.status).sort()).toEqual(["duplicate", "enqueued"]);
  const mail = await db.notification.findFirstOrThrow({ where: { kind: "GAME_WINNER" } });
  expect(mail.payload).toMatchObject({ winner: { wechatId: "alice", score: bot.score } });
  vi.stubEnv("LIVE_SCORES", "off");
  expect((await rankedWeek(db, weekKeyOf(start))).map(r => r.wechatId)).toEqual(["ALICE", "bob"]);
  expect((await getGameHub(db, now)).liveScores).toBe(false);
});

it("progress routes return 404 before even reading a body when disabled", async () => {
  vi.stubEnv("LIVE_SCORES", "off");
  const routes = await Promise.all([
    import("@/app/api/game/progress/route"), import("@/app/api/game/tu/progress/route"), import("@/app/api/game/m3/progress/route"),
  ]);
  for (const { POST } of routes) {
    const request = new Request("http://localhost/api/game/progress", { method: "POST", body: "not json" });
    const read = vi.spyOn(request, "text").mockRejectedValue(new Error("must not read"));
    expect((await POST(request)).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  }
});
