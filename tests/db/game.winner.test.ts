// Weekly game winner email (D114, NOTIFICATIONS.md): POST /api/cron/game-winner, the job and the
// GAME_WINNER template. Real renderer, fake transport (no real email).

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sent: [] as { idempotencyKey: string; subject: string; text: string }[],
  fail: false,
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("@/server/mailer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/mailer")>()),
  getTransport: () => ({
    async send(m: { idempotencyKey: string; subject: string; text: string }) {
      if (h.fail) throw new Error("provider down");
      h.sent.push({ idempotencyKey: m.idempotencyKey, subject: m.subject, text: m.text });
      return { id: "ok" };
    },
  }),
}));

import { POST as winnerPOST } from "@/app/api/cron/game-winner/route";
import { prisma } from "@/server/db";
import { renderNotification } from "@/server/emails";
import { enqueueGameWinner, loadGameWinner } from "@/server/gameWinner";
import { createDefaultProducts, createOpenDate, createOrder, createSettings, db, resetDb } from "./helpers";

// Monday 2026-10-26 09:00 CDT: last week = Mon 10/19 – Sun 10/25.
const NOW = new Date("2026-10-26T14:00:00Z");
const LAST = "2026-10-19";
const SECRET = "cron-secret-game-winner";
const SITE = "https://bunbunnybakes.shop";
const saved = { SITE_URL: process.env.SITE_URL, CRON_SECRET: process.env.CRON_SECRET };

const req = (auth: string | null = `Bearer ${SECRET}`) =>
  new Request("http://localhost/api/cron/game-winner", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });

let redBean: string;

async function run(o: { wechatId: string; nickname?: string; score: number; weekKey?: string; hidden?: boolean; finishedAt?: Date }) {
  const finishedAt = o.finishedAt ?? new Date("2026-10-21T17:00:00Z");
  return db.gameRun.create({
    data: {
      seed: "s",
      wechatId: o.wechatId,
      nickname: o.nickname ?? o.wechatId,
      tiersSnapshot: [],
      startedAt: finishedAt,
      finishedAt,
      score: o.score,
      weekKey: o.weekKey ?? LAST,
      hidden: o.hidden ?? false,
    },
  });
}

async function ordered(wechatId: string, status: "NEW" | "CANCELLED" = "NEW") {
  await createOrder({ date: "2026-10-28", wechatId, status, items: [{ productId: redBean, qty: 1 }] });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  h.sent.length = 0;
  h.fail = false;
  process.env.SITE_URL = `${SITE}/`;
  process.env.CRON_SECRET = SECRET;
  await resetDb();
  await db.gamePrizeWeek.create({ data: { weekKey: LAST, game: "BIG", chosenBy: "RANDOM" } });
  await createSettings({ orderingEnabled: true });
  redBean = (await createDefaultProducts()).redBean;
  await createOpenDate("2026-10-28");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await db.$disconnect();
  await prisma.$disconnect();
});

describe("POST /api/cron/game-winner", () => {
  it("401 without or with a wrong secret, and enqueues nothing", async () => {
    await run({ wechatId: "wx_top", score: 900 });
    expect((await winnerPOST(req(null))).status).toBe(401);
    expect((await winnerPOST(req("Bearer nope"))).status).toBe(401);
    expect(await db.notification.count()).toBe(0);
    expect(h.sent).toHaveLength(0);
  });

  it("enqueues and sends last week's winner once; a second call is a duplicate (one notification)", async () => {
    await run({ wechatId: "wx_top", nickname: "冠军", score: 900 });
    await ordered("WX_TOP");
    const res = await winnerPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "enqueued", send: "sent" });
    expect(h.sent).toEqual([
      {
        idempotencyKey: `game_winner:${LAST}`,
        subject: "👑 上周游戏冠军｜消除大面包 冠军 900 分",
        text: [
          "【10/19 周一 – 10/25 周日 的第一名】",
          "",
          "===== 消除大面包 =====",
          "昵称：冠军",
          "微信号：wx_top",
          "分数：900",
          "下过单：是",
          "",
          `[打开游戏后台] → ${SITE}/admin/game`,
        ].join("\n"),
      },
    ]);
    const n = await db.notification.findFirstOrThrow();
    expect(n).toMatchObject({ id: body.notificationId, kind: "GAME_WINNER", dedupeKey: `game_winner:${LAST}`, status: "SENT" });

    const again = await winnerPOST(req());
    expect(await again.json()).toEqual({ status: "duplicate" });
    expect(await db.notification.count()).toBe(1);
    expect(h.sent).toHaveLength(1);
  });

  it("nothing when last week had no runs (this week's and older runs do not count)", async () => {
    await run({ wechatId: "wx_now", score: 5, weekKey: "2026-10-26", finishedAt: new Date("2026-10-26T13:00:00Z") });
    await run({ wechatId: "wx_old", score: 5, weekKey: "2026-10-12", finishedAt: new Date("2026-10-14T13:00:00Z") });
    const res = await winnerPOST(req());
    expect(await res.json()).toEqual({ status: "empty" });
    expect(await db.notification.count()).toBe(0);
  });

  it("nothing when every run of last week is hidden or banned", async () => {
    await run({ wechatId: "wx_h", score: 5, hidden: true });
    await run({ wechatId: "wx_b", score: 9 });
    await db.gameBan.create({ data: { wechatId: "WX_B" } });
    expect(await (await winnerPOST(req())).json()).toEqual({ status: "empty" });
  });

  it("an outbox send failure still answers 200; the row stays PENDING for /api/cron/outbox", async () => {
    await run({ wechatId: "wx_top", score: 900 });
    h.fail = true;
    const res = await winnerPOST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "enqueued", send: "failed" });
    const n = await db.notification.findFirstOrThrow();
    expect(n).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(n.lastError).toContain("provider down");
  });
});

describe("winner selection and the ⚠️ path", () => {
  it("#1 has not ordered: ⚠️ and the highest-ranked player who has (ranks by best per id, hidden/banned skipped)", async () => {
    await run({ wechatId: "wx_first", nickname: "First", score: 1000 });
    await run({ wechatId: "wx_second", nickname: "Second", score: 800 }); // ordered, but only a cancelled order
    await run({ wechatId: "wx_hidden", nickname: "Hid", score: 950, hidden: true });
    await run({ wechatId: "wx_third", nickname: "Third", score: 700 });
    await run({ wechatId: "wx_third", nickname: "Third", score: 100 });
    await run({ wechatId: "wx_fourth", nickname: "Fourth", score: 600 });
    await ordered("wx_second", "CANCELLED");
    await ordered("Wx_Third");
    await ordered("wx_fourth");

    const p = await loadGameWinner(db, NOW);
    expect(p).toEqual({
      weekKey: LAST,
      game: "BIG",
      week: { start: LAST, end: "2026-10-25" },
      winner: { rank: 1, nickname: "First", wechatId: "wx_first", score: 1000, ordered: false },
      runnerUp: { rank: 3, nickname: "Third", wechatId: "wx_third", score: 700, ordered: true },
      siteUrl: SITE,
    });

    await winnerPOST(req());
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].subject).toBe("⚠️ 上周游戏冠军｜消除大面包 First 1000 分｜有冠军没下过单");
    expect(h.sent[0].text).toBe(
      [
        "【10/19 周一 – 10/25 周日 的第一名】",
          "",
          "===== 消除大面包 =====",
        "昵称：First",
        "微信号：wx_first",
        "分数：1000",
        "下过单：否",
        "",
        "⚠️ 第一名还没下过单，要不要发奖由你决定。",
        "",
        "【下过单的最高者：第 3 名】",
        "昵称：Third",
        "微信号：wx_third",
        "分数：700",
        "下过单：是",
        "",
        `[打开游戏后台] → ${SITE}/admin/game`,
      ].join("\n"),
    );
  });

  it("#1 has not ordered and nobody on the board has", async () => {
    await run({ wechatId: "wx_a", nickname: "A", score: 10 });
    await run({ wechatId: "wx_b", nickname: "B", score: 5 });
    const p = await loadGameWinner(db, NOW);
    expect(p?.runnerUp).toBeNull();
    const email = await renderNotification(db, { id: "n", kind: "GAME_WINNER", dedupeKey: "k", payload: p }, NOW);
    expect(email.text).toContain("⚠️ 第一名还没下过单");
    expect(email.text).toContain("榜上没有下过单的人。");
  });

  it("ties on last week's board go to the earliest finish; runnerUp is null when #1 has ordered", async () => {
    await run({ wechatId: "wx_late", score: 500, finishedAt: new Date("2026-10-24T12:00:00Z") });
    await run({ wechatId: "wx_early", score: 500, finishedAt: new Date("2026-10-20T12:00:00Z") });
    await ordered("wx_early");
    const p = await loadGameWinner(db, NOW);
    expect(p?.winner).toMatchObject({ wechatId: "wx_early", ordered: true });
    expect(p?.runnerUp).toBeNull();
  });

  it("concurrent jobs for the same week enqueue exactly one GAME_WINNER notification", async () => {
    await run({ wechatId: "wx_top", score: 900 });
    const results = await Promise.all([
      enqueueGameWinner(db, NOW),
      enqueueGameWinner(db, NOW),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["duplicate", "enqueued"]);
    expect(await db.notification.count({ where: { kind: "GAME_WINNER" } })).toBe(1);
    const n = await db.notification.findFirstOrThrow({ where: { kind: "GAME_WINNER" } });
    expect(n.dedupeKey).toBe(`game_winner:${LAST}`);
  });

  it("the job keys on the closed week whatever time on Monday (or later in the week) it runs", async () => {
    await run({ wechatId: "wx_top", score: 1 });
    // Monday 00:30 CDT and Wednesday both look back at the week of 10-19.
    for (const at of [new Date("2026-10-26T05:30:00Z"), new Date("2026-10-28T17:00:00Z")]) {
      expect((await loadGameWinner(db, at))?.weekKey).toBe(LAST);
    }
    const first = await enqueueGameWinner(db, NOW);
    expect(first.status).toBe("enqueued");
    expect(await enqueueGameWinner(db, new Date("2026-10-28T17:00:00Z"))).toEqual({ status: "duplicate" });
  });
});
