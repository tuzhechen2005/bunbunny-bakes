// POST /api/assistant (C3). fetch is always mocked: no real model calls in tests.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
import { POST } from "@/app/api/assistant/route";
import { GLOBAL_DAILY_LIMIT, GLOBAL_KEY, VISITOR_DAILY_LIMIT } from "@/server/assistant/usage";
import { prisma } from "@/server/db";
import { toDbDate } from "@/server/dbDates";
import { cleanup } from "@/server/maintenance";
import { hashIp } from "@/server/tokens";
import { jsonRequest, NOW, SITE } from "./api.helpers";
import {
  createDefaultProducts,
  createOpenDate,
  createOrder,
  createSettings,
  db,
  resetDb,
  type DefaultProductIds,
} from "./helpers";

let ids: DefaultProductIds;
const IP = "203.0.113.7";
const ENV_KEYS = ["SITE_URL", "IP_HASH_SECRET", "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "ASSISTANT_MODEL"] as const;
const saved: Record<string, string | undefined> = {};

type Upstream = { content?: string | null; tool_calls?: { id: string; name: string; args: unknown }[] } | Response;
let script: Upstream[];
let sent: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[];

function upstream(u: Upstream): Response {
  if (u instanceof Response) return u;
  const message: Record<string, unknown> = { role: "assistant", content: u.content ?? null };
  if (u.tool_calls) {
    message.tool_calls = u.tool_calls.map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.name, arguments: typeof c.args === "string" ? c.args : JSON.stringify(c.args) },
    }));
  }
  return Response.json({ choices: [{ index: 0, message, finish_reason: "stop" }] });
}

beforeEach(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.SITE_URL = SITE;
  process.env.IP_HASH_SECRET = "test-secret";
  process.env.DEEPSEEK_API_KEY = "sk-test";
  delete process.env.DEEPSEEK_BASE_URL;
  delete process.env.ASSISTANT_MODEL;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await resetDb();
  await createSettings({ orderingEnabled: true, ownerWechatId: "owner_wx_99", showWechatOnHome: true });
  ids = await createDefaultProducts();
  await db.product.update({ where: { id: ids.brulee }, data: { pickupWeekdays: [3] } });
  script = [];
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({
        url,
        body: JSON.parse(String(init.body)),
        headers: init.headers as Record<string, string>,
      });
      const next = script.shift();
      if (!next) throw new Error("unexpected upstream call");
      return upstream(next);
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
afterAll(async () => {
  await db.$disconnect();
  await prisma.$disconnect();
});

const user = (content: string) => ({ messages: [{ role: "user", content }], cart: [] });
const call = (body: unknown, headers: Record<string, string> = {}) =>
  POST(jsonRequest("/api/assistant", body, { origin: SITE, "x-forwarded-for": IP, ...headers }));

/** Tool results the model received, by tool call id. */
function toolResults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const last = sent[sent.length - 1].body.messages as { role: string; tool_call_id?: string; content: string }[];
  for (const m of last) if (m.role === "tool") out[m.tool_call_id!] = JSON.parse(m.content);
  return out;
}

describe("POST /api/assistant: request checks", () => {
  it("403 without a same-origin Origin header", async () => {
    const res = await POST(jsonRequest("/api/assistant", user("hi"), { "x-forwarded-for": IP }));
    expect(res.status).toBe(403);
    const other = await call(user("hi"), { origin: "https://evil.example" });
    expect(other.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ["no messages", { messages: [], cart: [] }],
    ["13 messages", { messages: Array.from({ length: 13 }, () => ({ role: "user", content: "a" })), cart: [] }],
    ["501 chars", { messages: [{ role: "user", content: "包".repeat(501) }], cart: [] }],
    ["last is assistant", { messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }], cart: [] }],
    ["system role", { messages: [{ role: "system", content: "a" }], cart: [] }],
    ["bad cart", { messages: [{ role: "user", content: "a" }], cart: [{ productId: "x", qty: 1 }] }],
    ["bad fulfillment", { messages: [{ role: "user", content: "a" }], cart: [], fulfillment: "SHIP" }],
    ["missing cart", { messages: [{ role: "user", content: "a" }] }],
  ])("400 VALIDATION: %s", async (_name, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("VALIDATION");
    expect(sent).toHaveLength(0);
  });

  it("400 on a non-JSON content type", async () => {
    const res = await POST(
      new Request(SITE + "/api/assistant", {
        method: "POST",
        headers: { origin: SITE, "content-type": "text/plain" },
        body: JSON.stringify(user("a")),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("503 without DEEPSEEK_API_KEY, nothing counted", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const res = await call(user("周四能取什么"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ASSISTANT_UNAVAILABLE" });
    expect(await db.assistantUsage.count()).toBe(0);
  });
});

describe("POST /api/assistant: limits", () => {
  it("counts per visitor and globally, returns remaining, 429 after 20", async () => {
    for (let i = 0; i < VISITOR_DAILY_LIMIT; i++) script.push({ content: "好的" });
    for (let i = 1; i <= VISITOR_DAILY_LIMIT; i++) {
      const res = await call(user("你好"));
      expect(res.status).toBe(200);
      expect((await res.json()).remaining).toBe(VISITOR_DAILY_LIMIT - i);
    }
    const over = await call(user("你好"));
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: "ASSISTANT_LIMIT" });
    const rows = await db.assistantUsage.findMany({ orderBy: { ipHash: "asc" } });
    expect(rows.map((r) => [r.ipHash, r.count])).toEqual([
      [GLOBAL_KEY, VISITOR_DAILY_LIMIT],
      [hashIp(IP, "test-secret"), VISITOR_DAILY_LIMIT + 1],
    ]);
    // Only counts are stored: the row has no other columns.
    expect(Object.keys(rows[0]).sort()).toEqual(["count", "day", "ipHash"]);
    // Another visitor still has a full budget.
    script.push({ content: "好的" });
    const other = await call(user("你好"), { "x-forwarded-for": "198.51.100.1" });
    expect((await other.json()).remaining).toBe(VISITOR_DAILY_LIMIT - 1);
  });

  it("429 when the site-wide budget is used up", async () => {
    await db.assistantUsage.create({ data: { day: toDbDate("2026-10-20"), ipHash: GLOBAL_KEY, count: GLOBAL_DAILY_LIMIT } });
    const res = await call(user("你好"));
    expect(res.status).toBe(429);
    expect(sent).toHaveLength(0);
  });

  it("resets on the next Chicago day and cleanup drops past days", async () => {
    await db.assistantUsage.create({ data: { day: toDbDate("2026-10-19"), ipHash: hashIp(IP, "test-secret"), count: 20 } });
    script.push({ content: "好的" });
    const res = await call(user("你好"));
    expect((await res.json()).remaining).toBe(VISITOR_DAILY_LIMIT - 1);
    await cleanup(db, NOW);
    const days = (await db.assistantUsage.findMany()).map((r) => r.day.toISOString().slice(0, 10));
    expect(new Set(days)).toEqual(new Set(["2026-10-20"]));
  });

  it("concurrent requests never exceed the visitor limit", async () => {
    await db.assistantUsage.create({
      data: { day: toDbDate("2026-10-20"), ipHash: hashIp(IP, "test-secret"), count: VISITOR_DAILY_LIMIT - 3 },
    });
    for (let i = 0; i < 10; i++) script.push({ content: "好的" });
    const results = await Promise.all(Array.from({ length: 10 }, () => call(user("你好"))));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
  });
});

describe("POST /api/assistant: model loop", () => {
  it("sends key, model, tools, low temperature, max_tokens and a scrubbed conversation", async () => {
    script.push({ content: "好的" });
    await call({
      messages: [
        { role: "user", content: "我的微信是 bunny_2024，电话 608-555-1234" },
        { role: "assistant", content: "请不要发微信号哦" },
        { role: "user", content: "送到 123 N. University Ave Apt 4B，邮箱 a.b@gmail.com" },
      ],
      cart: [{ productId: ids.redBean, qty: 2 }],
      fulfillment: "DELIVERY",
    });
    expect(sent).toHaveLength(1);
    const { url, body, headers } = sent[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(headers.authorization).toBe("Bearer sk-test");
    expect(body).toMatchObject({ model: "deepseek-chat", tool_choice: "auto", temperature: 0.3, max_tokens: 400, stream: false });
    expect((body.tools as { function: { name: string } }[]).map((t) => t.function.name)).toEqual([
      "get_menu",
      "check_date",
      "find_dates",
      "propose_cart",
    ]);
    const text = JSON.stringify(body.messages);
    for (const secret of ["bunny_2024", "608-555-1234", "University Ave", "a.b@gmail.com", "owner_wx_99"]) {
      expect(text).not.toContain(secret);
    }
    const system = (body.messages as { content: string }[])[0].content;
    expect(system).toContain("小小🐰");
    expect(system).toContain("奶酥红豆包（p1）× 2");
    expect(system).toContain("配送");
    expect(system).toContain("$5.00");
    expect(system).not.toMatch(/doughG|\d+\s*g\b|\d+\s*克|1600/);
  });

  it("honours DEEPSEEK_BASE_URL and ASSISTANT_MODEL", async () => {
    process.env.DEEPSEEK_BASE_URL = "https://proxy.example/v1/";
    process.env.ASSISTANT_MODEL = "deepseek-reasoner";
    script.push({ content: "好的" });
    await call(user("你好"));
    expect(sent[0].url).toBe("https://proxy.example/v1/chat/completions");
    expect(sent[0].body.model).toBe("deepseek-reasoner");
  });

  it("runs get_menu → check_date → propose_cart and returns the suggestion", async () => {
    await createOpenDate("2026-10-21"); // Wed
    await createOpenDate("2026-10-22"); // Thu
    script.push(
      { tool_calls: [{ id: "c1", name: "get_menu", args: {} }] },
      {
        tool_calls: [
          { id: "c2", name: "check_date", args: { items: [{ product: "p1", qty: 2 }], date: "2026-10-22" } },
          { id: "c3", name: "find_dates", args: { items: [{ product: "p4", qty: 1 }] } },
        ],
      },
      {
        tool_calls: [
          { id: "c4", name: "propose_cart", args: { items: [{ product: "p1", qty: 2 }], date: "2026-10-22", note: "两个红豆包，周四取" } },
        ],
      },
      { content: "**可以的！** 10/22 周四能取，[点这里](https://evil.example) 放进纸袋就行" },
    );
    const res = await call(user("周四能取两个红豆包吗"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      reply: "可以的！ 10/22 周四能取，点这里 放进纸袋就行",
      suggestion: { items: [{ productId: ids.redBean, qty: 2 }], date: "2026-10-22", note: "两个红豆包，周四取" },
      remaining: VISITOR_DAILY_LIMIT - 1,
    });
    expect(sent).toHaveLength(4);
    const results = toolResults();
    const menu = results.c1 as { products: { id: string; name: string; pickupDays: string }[] };
    expect(menu.products.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(menu.products[3].pickupDays).toBe("只能周三取");
    expect(results.c2).toMatchObject({ date: "2026-10-22", state: "AVAILABLE", cutoff: "10/21 周三 20:00 截止" });
    // Brulee needs 2 days' notice: 10/21 is already past its cutoff, 10/22 is a Thursday.
    expect(results.c3).toEqual({ dates: [], meaning: expect.any(String) });
    // Totals come from the server's pricing, never from the model.
    const [unit] = await db.product.findMany({ where: { id: ids.redBean }, select: { unitPriceCents: true } });
    const cents = unit.unitPriceCents * 2;
    expect(results.c4).toMatchObject({ ok: true, 小计: `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}` });
  });

  it("tool outputs never carry grams, limits, used amounts, orders or customers", async () => {
    await createOpenDate("2026-10-22", { doughLimitG: 140 });
    await createOrder({ date: "2026-10-22", items: [{ productId: ids.redBean, qty: 1 }], wechatId: "cust_secret_1" });
    script.push(
      {
        tool_calls: [
          { id: "m", name: "get_menu", args: {} },
          { id: "d", name: "check_date", args: { items: [{ product: "奶酥红豆包", qty: 2 }], date: "2026-10-22" } },
          { id: "n", name: "check_date", args: { items: [{ product: "p1", qty: 1 }], date: "2026-11-30" } },
          { id: "f", name: "find_dates", args: { items: [{ product: "p1", qty: 2 }], fulfillment: "DELIVERY" } },
        ],
      },
      { content: "去掉 1 个就能订" },
    );
    await call(user("10/22 要 2 个红豆包"));
    const r = toolResults();
    expect(r.d).toMatchObject({
      state: "FULL",
      办法: [{ 办法: expect.any(String), 去掉: [{ name: "奶酥红豆包", qty: 1 }] }],
    });
    expect(r.n).toMatchObject({ state: "NOT_OFFERED" });
    const all = JSON.stringify(r);
    expect(all).not.toMatch(/doughG|roundG|dailyLimit|batchYield|capacity|140|70|1600|cust_secret_1|owner_wx_99/);
  });

  it("WEEKDAY dates come back with a SPLIT hint", async () => {
    await createOpenDate("2026-10-22"); // Thu
    await createOpenDate("2026-10-28"); // Wed
    script.push(
      {
        tool_calls: [
          { id: "w", name: "check_date", args: { items: [{ product: "p1", qty: 1 }, { product: "p4", qty: 1 }], date: "2026-10-22" } },
        ],
      },
      { content: "布蕾只能周三取" },
    );
    await call(user("周四要红豆包和布蕾"));
    expect(toolResults().w).toMatchObject({
      state: "WEEKDAY",
      办法: [{ 这一天订: [{ name: "奶酥红豆包", qty: 1 }], 剩下: [{ name: "焦糖布蕾", qty: 1 }], 剩下可以订: "2026-10-28（10/28 周三）" }],
    });
  });

  it("propose_cart rejects bad proposals; no suggestion is returned", async () => {
    await createOpenDate("2026-10-22");
    await db.product.update({ where: { id: ids.rockCheese }, data: { status: "PAUSED" } });
    script.push(
      {
        tool_calls: [
          { id: "a", name: "propose_cart", args: { items: [{ product: "p9", qty: 1 }], note: "x" } },
          { id: "b", name: "propose_cart", args: { items: [{ product: "p1", qty: 9 }], note: "x" } },
          { id: "c", name: "propose_cart", args: { items: [{ product: "p2", qty: 1 }], note: "x" } },
          { id: "d", name: "propose_cart", args: { items: [{ product: "p1", qty: 1 }], date: "2026-10-23", note: "x" } },
          { id: "e", name: "propose_cart", args: "{not json" },
          { id: "f", name: "drop_tables", args: {} },
        ],
      },
      { content: "抱歉" },
    );
    const body = await (await call(user("帮我配"))).json();
    expect(body.suggestion).toBeUndefined();
    const r = toolResults();
    for (const id of ["a", "b", "c", "d", "e", "f"]) expect(r[id]).toHaveProperty("error");
  });

  it("propose_cart without a date; note is scrubbed, stripped and capped", async () => {
    script.push(
      {
        tool_calls: [
          { id: "a", name: "propose_cart", args: { items: [{ product: "p1", qty: 1 }, { product: "p1", qty: 2 }], note: `<b>加我 vx: abc_123</b>${"好".repeat(200)}` } },
        ],
      },
      { content: "" },
    );
    const body = await (await call(user("随便配"))).json();
    expect(body.suggestion.items).toEqual([{ productId: ids.redBean, qty: 3 }]);
    expect(body.suggestion.date).toBeNull();
    expect(body.suggestion.note).not.toContain("abc_123");
    expect(body.suggestion.note).not.toContain("<b>");
    expect([...body.suggestion.note].length).toBeLessThanOrEqual(100);
    expect(body.reply.length).toBeGreaterThan(0); // fallback when the model says nothing
  });

  it("stops after 4 tool rounds: the 5th call has tool_choice none", async () => {
    for (let i = 0; i < 4; i++) script.push({ tool_calls: [{ id: `t${i}`, name: "get_menu", args: {} }] });
    script.push({ content: "好的" });
    const res = await call(user("你好"));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(5);
    expect(sent.slice(0, 4).every((s) => s.body.tool_choice === "auto")).toBe(true);
    expect(sent[4].body.tool_choice).toBe("none");
  });

  it("caps the reply at 400 characters", async () => {
    script.push({ content: "面".repeat(1000) });
    const body = await (await call(user("你好"))).json();
    expect([...body.reply]).toHaveLength(400);
  });

  it.each([
    ["402 balance exhausted", () => new Response("{}", { status: 402 })],
    ["500", () => new Response("oops", { status: 500 })],
    ["not json", () => new Response("<html>", { status: 200 })],
    ["no choices", () => Response.json({})],
  ])("503 on upstream %s, without logging content", async (_n, make) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    script.push(make());
    const res = await call(user("我的秘密问题"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "ASSISTANT_UNAVAILABLE" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("秘密");
    spy.mockRestore();
  });

  it("503 on a network error or timeout", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect((await call(user("你好"))).status).toBe(503);
    spy.mockRestore();
  });
});
