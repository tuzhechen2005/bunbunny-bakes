// renderNotification: exact subject + body per docs/NOTIFICATIONS.md §2–§5 and CAPACITY_RULES §10.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { renderNotification, type NotificationToRender } from "@/server/emails";
import { loadDailySummary } from "@/server/summaryJob";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

const SITE = "https://bunbunnybakes.com";
// 20:05 on 2026-10-29 in Chicago (CDT) -> X = 10/29, tomorrow = Fri 10/30.
const NOW = new Date("2026-10-30T01:05:00Z");

let ids: DefaultProductIds;

beforeEach(async () => {
  await resetDb();
  process.env.SITE_URL = `${SITE}/`; // trailing slash is trimmed
  await createSettings({ orderingEnabled: true });
  ids = await createDefaultProducts();
});

afterAll(async () => {
  await db.$disconnect();
});

function note(
  kind: NotificationToRender["kind"],
  payload: unknown,
): NotificationToRender {
  return { id: "n1", kind, dedupeKey: "k", payload };
}

async function order1030004(extra: { note?: string; fulfillment?: "PICKUP" | "DELIVERY" } = {}) {
  await createOpenDate("2026-10-30");
  const o = await createOrder({
    date: "2026-10-30",
    wechatId: "bunny_fan_01",
    fulfillment: extra.fulfillment,
    items: [
      { productId: ids.redBean, qty: 4 },
      { productId: ids.cheeseHorn, qty: 4 },
    ],
  });
  return db.order.update({
    where: { id: o.id },
    data: { orderNo: "1030-004", note: extra.note ?? null },
    include: { items: true },
  });
}

describe("NEW_ORDER", () => {
  it("renders the documented subject and body", async () => {
    const o = await order1030004();
    const r = await renderNotification(db, note("NEW_ORDER", { orderId: o.id }), NOW);
    expect(r.subject).toBe("🍞 新订单 1030-004｜10/30 周五 自提｜$19.98");
    expect(r.text).toBe(
      [
        "微信号：bunny_fan_01",
        "",
        "奶酥红豆包 × 4",
        "奶酪角 × 4",
        "",
        "小计 $19.98　运费 $0.00　总额 $19.98",
        "取货：10/30 周五　自提",
        "备注：（无）",
        "",
        `[打开订单] → https://bunbunnybakes.com/admin/orders/${o.id}`,
      ].join("\n"),
    );
  });

  it("shows the note and delivery, and never contains the customer's viewToken", async () => {
    const o = await order1030004({ note: "少糖", fulfillment: "DELIVERY" });
    const r = await renderNotification(db, note("NEW_ORDER", { orderId: o.id }), NOW);
    expect(r.subject).toBe("🍞 新订单 1030-004｜10/30 周五 配送｜$24.98");
    expect(r.text).toContain("小计 $19.98　运费 $5.00　总额 $24.98");
    expect(r.text).toContain("取货：10/30 周五　配送");
    expect(r.text).toContain("备注：少糖");
    expect(r.subject + r.text).not.toContain(o.viewToken);
    expect(r.text).not.toContain("/o/");
  });

  it("uses the name snapshot, not the current product name", async () => {
    const o = await order1030004();
    await db.product.update({ where: { id: ids.redBean }, data: { name: "改名了" } });
    const r = await renderNotification(db, note("NEW_ORDER", { orderId: o.id }), NOW);
    expect(r.text).toContain("奶酥红豆包 × 4");
    expect(r.text).not.toContain("改名了");
  });

  it("throws when the order does not exist", async () => {
    await expect(
      renderNotification(db, note("NEW_ORDER", { orderId: "00000000-0000-4000-8000-000000000000" }), NOW),
    ).rejects.toThrow(/not found/);
  });
});

describe("CUSTOMER_CANCELLED", () => {
  it("renders the documented subject and body", async () => {
    const o = await order1030004();
    const r = await renderNotification(db, note("CUSTOMER_CANCELLED", { orderId: o.id }), NOW);
    expect(r.subject).toBe("取消 1030-004｜10/30 周五｜微信号 bunny_fan_01");
    expect(r.text).toBe(["奶酥红豆包 × 4", "奶酪角 × 4", "", "名额已释放"].join("\n"));
    expect(r.subject + r.text).not.toContain(o.viewToken);
  });
});

describe("PASSWORD_RESET", () => {
  it("renders the link, validity and ignore notice", async () => {
    const url = `${SITE}/admin/reset?token=abc`;
    const r = await renderNotification(db, note("PASSWORD_RESET", { url }), NOW);
    expect(r.subject).toBe("后台密码重置");
    expect(r.text).toBe(
      [
        "点这个链接重置后台密码：",
        url,
        "",
        "15 分钟内有效，只能用一次。",
        "如果不是你本人操作，忽略这封邮件即可。",
      ].join("\n"),
    );
  });

  it("throws when the url was scrubbed, so it can never be re-sent", async () => {
    await expect(renderNotification(db, note("PASSWORD_RESET", {}), NOW)).rejects.toThrow(/scrubbed/);
    await expect(renderNotification(db, note("PASSWORD_RESET", { url: null }), NOW)).rejects.toThrow();
    await expect(renderNotification(db, note("PASSWORD_RESET", null), NOW)).rejects.toThrow();
  });
});

/** The CAPACITY_RULES §10 example plus tomorrow-night 9 cups, 7 pickups / 5 deliveries, 2 unconfirmed. */
async function seedSection10Example() {
  await createOpenDate("2026-10-30");
  await createOpenDate("2026-10-31");
  const plan: { productId: string; qty: number }[] = [
    ...[0, 1, 2].map(() => ({ productId: ids.redBean, qty: 2 })),
    ...[0, 1, 2].map(() => ({ productId: ids.rockCheese, qty: 2 })),
    ...[0, 1, 2].map(() => ({ productId: ids.cheeseHorn, qty: 2 })),
    { productId: ids.brulee, qty: 7 },
    { productId: ids.brulee, qty: 7 },
    { productId: ids.brulee, qty: 6 },
  ];
  for (const [i, line] of plan.entries()) {
    await createOrder({
      date: "2026-10-30",
      items: [line],
      fulfillment: i < 7 ? "PICKUP" : "DELIVERY",
      status: i === 1 ? "NEW" : "CONFIRMED",
      wechatId: i === 1 ? "xxx" : `wx${i}`,
    });
  }
  await createOrder({
    date: "2026-10-31",
    items: [{ productId: ids.brulee, qty: 9 }],
    status: "CONTACTED",
    wechatId: "yyy",
  });
}

async function summaryNote(now = NOW) {
  const summary = await loadDailySummary(db, now);
  // Round-trip through JSON, as the outbox stores it.
  const payload = JSON.parse(JSON.stringify({ ...summary, siteUrl: SITE }));
  return note("DAILY_SUMMARY", payload);
}

describe("DAILY_SUMMARY", () => {
  it("renders the §10 example exactly", async () => {
    await seedSection10Example();
    const r = await renderNotification(db, await summaryNote(), NOW);
    expect(r.subject).toBe("🐰 明天 10/30 周五：面包 18 个 · 1520 g｜今晚布蕾 20 杯");
    expect(r.text).toBe(
      [
        "【明天 10/30 周五 的面包】",
        "奶酥红豆包 6",
        "岩烧乳酪包 6",
        "奶酪角 6（做 2 个大圆包，多出 2 角）",
        "面团 1520 / 1600 g",
        "",
        "【今晚要做的布蕾】（10/30 取货）",
        "20 杯 → 7 批，多出 1 杯",
        "",
        "【明晚要做的布蕾】（10/31 取货，刚截止）",
        "9 杯 → 3 批",
        "",
        "【明天的交付】",
        "自提 7 单　配送 5 单",
        "",
        "【还没确认的订单】",
        "1030-002　微信 xxx（新订单）",
        "1031-001　微信 yyy（已联系）",
        "",
        "[打开后台] → https://bunbunnybakes.com/admin",
      ].join("\n"),
    );
  });

  it("tomorrow not open, brûlée the day after: 明天没有开放 plus tomorrow night", async () => {
    await createOpenDate("2026-10-31");
    await createOrder({
      date: "2026-10-31",
      items: [{ productId: ids.brulee, qty: 9 }],
      status: "CONFIRMED",
    });
    const r = await renderNotification(db, await summaryNote(), NOW);
    expect(r.subject).toBe("🐰 明天 10/30 周五没有开放");
    expect(r.text).toBe(
      [
        "【明天 10/30 周五 的面包】",
        "明天没有开放",
        "",
        "【明晚要做的布蕾】（10/31 取货，刚截止）",
        "9 杯 → 3 批",
        "",
        "[打开后台] → https://bunbunnybakes.com/admin",
      ].join("\n"),
    );
  });

  it("omits empty parts: bread only has no brûlée part in the subject or body", async () => {
    await createOpenDate("2026-10-30");
    await createOrder({
      date: "2026-10-30",
      items: [{ productId: ids.redBean, qty: 6 }],
      status: "CONFIRMED",
    });
    const r = await renderNotification(db, await summaryNote(), NOW);
    expect(r.subject).toBe("🐰 明天 10/30 周五：面包 6 个 · 420 g");
    expect(r.text).toBe(
      [
        "【明天 10/30 周五 的面包】",
        "奶酥红豆包 6",
        "面团 420 / 1600 g",
        "",
        "【明天的交付】",
        "自提 1 单　配送 0 单",
        "",
        "[打开后台] → https://bunbunnybakes.com/admin",
      ].join("\n"),
    );
  });
});
