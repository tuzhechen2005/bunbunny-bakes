// Admin game endpoints with ?game=run (S2, D135): board, suspicious flag, hide, per-game awards,
// shared bans; and the weekly winner email with a 兔兔跑酷 section.

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
import { GET as boardGET } from "@/app/api/admin/game/leaderboard/route";
import { PATCH as runPATCH } from "@/app/api/admin/game/runs/[id]/route";
import { createSession, hashPassword } from "@/server/auth";
import { prisma } from "@/server/db";
import { renderNotification } from "@/server/emails";
import { weekKeyOf } from "@/server/gameAdmin";
import { enqueueGameWinner, loadGameWinner } from "@/server/gameWinner";
import { createDefaultProducts, createOpenDate, createOrder, createSettings, db, resetDb, type DefaultProductIds } from "./helpers";

const SITE = "https://bunbunnybakes.shop";
let previousSiteUrl: string | undefined;
let P: DefaultProductIds;

function req(method: string, path: string, body?: unknown) {
  return new Request(SITE + path, {
    method,
    headers: { "content-type": "application/json", ...(method === "GET" ? {} : { origin: SITE }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const board = async (query = "") => (await boardGET(req("GET", `/api/admin/game/leaderboard${query}`))).json();

beforeAll(() => {
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
});

afterAll(async () => {
  if (previousSiteUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousSiteUrl;
  await db.$disconnect();
  await prisma.$disconnect();
});

const THIS_WEEK = weekKeyOf(new Date());

async function insertRun(
  game: "BIG" | "TU" | "RUN",
  wechatId: string,
  score: number,
  o: { minutesAgo?: number; week?: string; finishedAt?: Date; suspicious?: boolean; hidden?: boolean } = {},
) {
  const finishedAt = o.finishedAt ?? new Date(Date.now() - (o.minutesAgo ?? 0) * 60_000);
  const r = await db.gameRun.create({
    data: {
      game,
      seed: "s",
      wechatId,
      nickname: wechatId.slice(0, 10),
      tiersSnapshot: [],
      startedAt: finishedAt,
      finishedAt,
      score,
      weekKey: o.week ?? THIS_WEEK,
      hidden: o.hidden ?? false,
      dropCount: 30,
      ...(game === "BIG" ? { simSteps: 3600 } : { playMs: 61_400, suspicious: o.suspicious ?? false }),
    },
  });
  return r.id;
}

describe("admin board ?game=run", () => {
  it("shows only that game's runs and weeks; the default and ?game=big stay the first game", async () => {
    await insertRun("BIG", "big_w", 900);
    await insertRun("TU", "tu_w", 800);
    await insertRun("RUN", "run_w", 300, { suspicious: true });
    await insertRun("RUN", "run_old", 5, { week: "2026-09-07", finishedAt: new Date("2026-09-08T12:00:00Z") });
    const run = await board("?game=run");
    expect(run.rows.map((r: { wechatId: string }) => r.wechatId)).toEqual(["run_w"]);
    expect(run.rows[0]).toMatchObject({ rank: 1, dropCount: 30, durationSec: 61, suspicious: true, verified: true });
    expect(run.winner).toMatchObject({ wechatId: "run_w", stored: false });
    expect(run.weeks).toContain("2026-09-07");
    for (const q of ["", "?game=big"]) {
      const big = await board(q);
      expect(big.rows.map((r: { wechatId: string }) => r.wechatId)).toEqual(["big_w"]);
      expect(big.rows[0]).toMatchObject({ durationSec: 30, suspicious: false });
      expect(big.weeks).not.toContain("2026-09-07");
    }
    expect((await board("?game=tu")).rows.map((r: { wechatId: string }) => r.wechatId)).toEqual(["tu_w"]);
    expect((await boardGET(req("GET", "/api/admin/game/leaderboard?game=xyz"))).status).toBe(422);
  });

  it("bans are one shared list: a ban drops the id from both games' boards", async () => {
    await insertRun("BIG", "Cheat_W", 900);
    await insertRun("RUN", "cheat_w", 300);
    await insertRun("RUN", "fair_w", 10);
    expect((await banPOST(req("POST", "/api/admin/game/bans", { wechatId: "CHEAT_W" }))).status).toBe(201);
    const run = await board("?game=run");
    expect(run.rows.find((r: { wechatId: string }) => r.wechatId === "cheat_w")).toMatchObject({ banned: true, rank: null });
    expect(run.winner.wechatId).toBe("fair_w");
    expect(run.bans).toHaveLength(1);
    expect((await board()).winner).toBeNull();
  });

  it("hide works with ?game=run; a run of the other game is 404", async () => {
    const runRun = await insertRun("RUN", "run_top", 500);
    await insertRun("RUN", "run_two", 400);
    const bigRun = await insertRun("BIG", "big_top", 500);
    expect((await runPATCH(req("PATCH", "/x?game=run", { hidden: true }), idCtx(runRun))).status).toBe(200);
    expect((await board("?game=run")).winner.wechatId).toBe("run_two");
    expect((await runPATCH(req("PATCH", "/x?game=run", { hidden: true }), idCtx(bigRun))).status).toBe(404);
    expect((await runPATCH(req("PATCH", "/x", { hidden: true }), idCtx(runRun))).status).toBe(404);
    expect((await runPATCH(req("PATCH", "/x", { hidden: true }), idCtx(bigRun))).status).toBe(200);
  });

  it("awards are per game and week: both games can have an award for the same week", async () => {
    expect((await awardPATCH(req("PATCH", "/x?game=run", { week: THIS_WEEK, contacted: true }))).status).toBe(422); // nobody yet
    const runWin = await insertRun("RUN", "run_win", 700);
    const bigWin = await insertRun("BIG", "big_win", 9000);
    expect((await awardPATCH(req("PATCH", "/x?game=run", { week: THIS_WEEK, contacted: true }))).status).toBe(200);
    expect((await awardPATCH(req("PATCH", "/x", { week: THIS_WEEK, note: "大面包" }))).status).toBe(200);
    expect((await awardPATCH(req("PATCH", "/x?game=run", { week: THIS_WEEK, redeemed: true, note: "兔" }))).status).toBe(200);
    const run = await board("?game=run");
    expect(run.winner).toMatchObject({ stored: true, runId: runWin, note: "兔" });
    expect(run.winner.contactedAt).not.toBeNull();
    expect(run.winner.redeemedAt).not.toBeNull();
    const big = await board();
    expect(big.winner).toMatchObject({ stored: true, runId: bigWin, note: "大面包", contactedAt: null, redeemedAt: null });
    expect(await db.gameAward.count()).toBe(2);
    const audits = await db.auditLog.findMany({ where: { action: "game.award" }, orderBy: { at: "asc" } });
    expect(audits.map((a) => a.entityId)).toEqual([`RUN:${THIS_WEEK}`, THIS_WEEK, `RUN:${THIS_WEEK}`]);
    expect((await awardPATCH(req("PATCH", "/x?game=nope", { week: THIS_WEEK }))).status).toBe(422);
  });
});

describe("weekly winner email selects only the closed week's prize game", () => {
  const NOW = new Date("2026-10-26T14:00:00Z");
  const LAST = "2026-10-19";
  const at = new Date("2026-10-21T17:00:00Z");

  it("RUN prize: ignores BIG, preserves the warning and eligible runner-up, even if this week is BIG", async () => {
    await db.gamePrizeWeek.createMany({ data: [
      { weekKey: LAST, game: "RUN", chosenBy: "OWNER" },
      { weekKey: "2026-10-26", game: "BIG", chosenBy: "RANDOM" },
    ] });
    await createOpenDate("2026-10-28");
    await createOrder({ date: "2026-10-28", wechatId: "run_two", items: [{ productId: P.redBean, qty: 1 }] });
    await insertRun("BIG", "big_one", 900, { week: LAST, finishedAt: at });
    await insertRun("RUN", "run_one", 300, { week: LAST, finishedAt: at });
    await insertRun("RUN", "run_two", 200, { week: LAST, finishedAt: at });
    const p = await loadGameWinner(db, NOW);
    expect(p).toMatchObject({ game: "RUN", weekKey: LAST,
      winner: { rank: 1, wechatId: "run_one", score: 300, ordered: false },
      runnerUp: { rank: 2, wechatId: "run_two", ordered: true },
    });
    const email = await renderNotification(db, { id: "n", kind: "GAME_WINNER", dedupeKey: "k", payload: p }, NOW);
    expect(email.subject).toBe("⚠️ 上周游戏冠军｜兔兔跑酷 run_one 300 分｜有冠军没下过单");
    expect(email.text).toContain("===== 兔兔跑酷 =====");
    expect(email.text).toContain("【下过单的最高者：第 2 名】");
    expect(email.text).toContain("微信号：run_two");
    expect(email.text).toContain(`${SITE}/admin/game`);
    expect(email.text).not.toContain("消除大面包");
    expect(JSON.stringify(p)).not.toContain("big_one");
    expect(await enqueueGameWinner(db, NOW)).toMatchObject({ status: "enqueued" });
    expect(await enqueueGameWinner(db, NOW)).toMatchObject({ status: "duplicate" });
    expect(await db.notification.count({ where: { kind: "GAME_WINNER" } })).toBe(1);
  });

  it("an empty prize board sends nothing even when the other board has a winner", async () => {
    await db.gamePrizeWeek.create({ data: { weekKey: LAST, game: "RUN", chosenBy: "RANDOM" } });
    await insertRun("BIG", "big_one", 900, { week: LAST, finishedAt: at });
    await insertRun("RUN", "run_hidden", 300, { week: LAST, finishedAt: at, hidden: true });
    expect(await loadGameWinner(db, NOW)).toBeNull();
  });
});
