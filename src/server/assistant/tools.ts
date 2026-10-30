// 小小🐰 tools (C3, D117). All read-only; every output is public data only: names, prices,
// dates, states and cart quantities. Never grams, limits, used/remaining amounts, orders or
// customers (there is no tool that reads orders). Arguments come from the model, so they are
// validated with Zod and treated as untrusted.

import { z } from "zod";
import { listAvailability, planCart, type AvailabilityInput, type DateHint, type DateState } from "@/domain/availability";
import { cutoffAt, cutoffLabel, leadDaysOf } from "@/domain/cutoff";
import { dayLabel, isLocalDate } from "@/domain/dates";
import { formatCents, priceCart } from "@/domain/pricing";
import type { CartLine, Fulfillment, LocalDate } from "@/domain/types";
import { copy } from "@/copy";
import type { Menu, MenuProduct } from "../menu";
import { scrubPii } from "./scrub";
import { plainText } from "./text";

export const NOTE_MAX = 100;
const MAX_TOOL_ITEMS = 20;

export interface Suggestion {
  items: CartLine[];
  date: LocalDate | null;
  note: string;
}

/** Everything the tools read: one snapshot loaded per request. */
export interface ToolContext {
  menu: Menu;
  /** Availability data with an empty cart; tools substitute their own cart. */
  availability: AvailabilityInput;
  /** Default fulfillment (the customer's checkout choice, else PICKUP). */
  fulfillment: Fulfillment;
  /** Set by propose_cart; the last valid proposal wins. */
  suggestion?: Suggestion;
}

/** Short product refs ("p1", "p2" …, menu order) so the model never copies UUIDs. */
export function productRefs(menu: Menu): Map<string, MenuProduct> {
  return new Map(menu.products.map((p, i) => [`p${i + 1}`, p]));
}

export function refOf(menu: Menu, id: string): string | null {
  const i = menu.products.findIndex((p) => p.id === id);
  return i < 0 ? null : `p${i + 1}`;
}

function resolve(menu: Menu, ref: string): MenuProduct | null {
  const r = ref.trim();
  const byRef = productRefs(menu).get(r.toLowerCase());
  if (byRef) return byRef;
  return menu.products.find((p) => p.id === r || p.name === r) ?? null;
}

function weekdaysText(days: number[]): string {
  if (days.length === 0) return "每天都可以取";
  return `只能${days.map((d) => copy.dates.weekdays[d]).join("、")}取`;
}

export function publicProduct(menu: Menu, p: MenuProduct, ref: string) {
  return {
    id: ref,
    name: p.name,
    price: `${formatCents(p.unitPriceCents)} / 个`,
    ...(p.bundlePriceCents !== null && p.bundleSize > 1
      ? { bundle: `${p.bundleSize} 个 ${formatCents(p.bundlePriceCents)}` }
      : {}),
    status: p.status === "ACTIVE" ? "可以订" : "暂停供应",
    leadDays: `需提前 ${p.leadDays} 天订`,
    pickupDays: weekdaysText(p.pickupWeekdays),
    // Owner-written public text; long enough for flavour lists (a 176-char 泡芙 description was cut at 80).
    description: plainText(p.description, 600),
  };
}

// ---- argument schemas -----------------------------------------------------------------

const Item = z.object({
  product: z.string().min(1).max(80),
  qty: z.number().int().min(1).max(99),
});
const Items = z.array(Item).min(1).max(MAX_TOOL_ITEMS);
const FulfillmentArg = z.enum(["PICKUP", "DELIVERY"]).optional();
const DateArg = z.string().refine(isLocalDate, { message: "date must be YYYY-MM-DD" });

const CheckDateArgs = z.object({ items: Items, date: DateArg, fulfillment: FulfillmentArg });
const FindDatesArgs = z.object({ items: Items, fulfillment: FulfillmentArg });
const ProposeArgs = z.object({
  items: Items,
  date: DateArg.nullable().optional(),
  note: z.string().max(400).default(""),
});

// ---- tool definitions (OpenAI-compatible function calling) ---------------------------

const itemsSchema = {
  type: "array",
  description: "购物车内容。product 用 get_menu 返回的 id（如 p1），qty 为件数",
  items: {
    type: "object",
    properties: {
      product: { type: "string", description: "商品 id，如 p1" },
      qty: { type: "integer", minimum: 1 },
    },
    required: ["product", "qty"],
  },
} as const;
const fulfillmentSchema = {
  type: "string",
  enum: ["PICKUP", "DELIVERY"],
  description: "PICKUP 自提，DELIVERY 配送；不填用顾客当前的选择",
} as const;

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "get_menu",
      description: "店里的全部商品：id、名字、价格、组合价、需提前几天订、哪几天能取、简介",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "check_date",
      description: "查某一天能不能订这些面包。返回这一天的状态，订不下时给出可行的办法（去掉几个、分两单）",
      parameters: {
        type: "object",
        properties: {
          items: itemsSchema,
          date: { type: "string", description: "取货日期 YYYY-MM-DD" },
          fulfillment: fulfillmentSchema,
        },
        required: ["items", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_dates",
      description: "找最近能订下这些面包的日期（最多 5 个）",
      parameters: {
        type: "object",
        properties: { items: itemsSchema, fulfillment: fulfillmentSchema },
        required: ["items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_cart",
      description:
        "给顾客一张「放进纸袋」的建议卡片（不会下单，顾客自己确认后再下单）。date 可选，必须是查过能订的日期",
      parameters: {
        type: "object",
        properties: {
          items: itemsSchema,
          date: { type: "string", description: "建议的取货日期 YYYY-MM-DD，可不填" },
          note: { type: "string", description: "一句简短说明（不超过 40 字）" },
        },
        required: ["items", "note"],
      },
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["function"]["name"];

// ---- execution --------------------------------------------------------------------------

type Resolved = { ok: true; lines: CartLine[] } | { ok: false; error: string };

/** Resolves refs to product ids and merges duplicates (first-seen order). */
function resolveItems(ctx: ToolContext, items: z.infer<typeof Items>): Resolved {
  const totals = new Map<string, number>();
  for (const item of items) {
    const p = resolve(ctx.menu, item.product);
    if (!p) return { ok: false, error: `找不到商品「${plainText(item.product, 40)}」，请先用 get_menu 查 id` };
    totals.set(p.id, (totals.get(p.id) ?? 0) + item.qty);
  }
  return { ok: true, lines: [...totals].map(([productId, qty]) => ({ productId, qty })) };
}

function namedLines(ctx: ToolContext, lines: CartLine[]) {
  return lines.map((l) => ({
    name: ctx.menu.products.find((p) => p.id === l.productId)?.name ?? "?",
    qty: l.qty,
  }));
}

const STATE_TEXT: Record<DateState, string> = {
  AVAILABLE: "可以订",
  CUTOFF: "已经过了截止时间，不能订",
  WEEKDAY: "有商品这一天不能取",
  FULL: "这一天订满了，订不下这么多",
  DELIVERY_FULL: "这一天配送满了，可以改成自提",
};

function hintView(ctx: ToolContext, h: DateHint) {
  if (h.kind === "REDUCE") return { 办法: "去掉一些就能订这一天", 去掉: namedLines(ctx, h.remove) };
  return {
    办法: h.reason === "WEEKDAY" ? "有商品只能在别的日子取，可以分两单" : "这一天能先订一部分，剩下的另订一天",
    这一天订: namedLines(ctx, h.here),
    剩下: namedLines(ctx, h.rest),
    剩下可以订: h.restDate ? `${h.restDate}（${dayLabel(h.restDate)}）` : "暂时没有合适的日子",
  };
}

function problemsOf(ctx: ToolContext, lines: CartLine[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const p = ctx.menu.products.find((x) => x.id === l.productId);
    if (!p || p.status !== "ACTIVE") out.push(`${p?.name ?? "?"} 暂停供应，现在不能订`);
    if (l.qty > ctx.menu.maxQtyPerItem) out.push(`${p?.name ?? "?"} 每单最多 ${ctx.menu.maxQtyPerItem} 个`);
  }
  return out;
}

function inputFor(ctx: ToolContext, lines: CartLine[], fulfillment: Fulfillment | undefined): AvailabilityInput {
  return { ...ctx.availability, cart: lines, fulfillment: fulfillment ?? ctx.fulfillment };
}

function cutoffText(ctx: ToolContext, lines: CartLine[], date: LocalDate): string {
  const lead = leadDaysOf(lines, ctx.availability.products);
  return cutoffLabel(cutoffAt(date, lead, ctx.availability.cutoffTime));
}

/** Server-side price of a validated cart (same rules as checkout); lines are merged and ACTIVE. */
function priceFor(ctx: ToolContext, lines: CartLine[], fulfillment: Fulfillment) {
  const priced = lines.map((l) => {
    const p = ctx.menu.products.find((x) => x.id === l.productId)!;
    return {
      productId: l.productId,
      qty: l.qty,
      price: { unitPriceCents: p.unitPriceCents, bundleSize: p.bundleSize, bundlePriceCents: p.bundlePriceCents },
    };
  });
  const pricing = priceCart(priced, fulfillment, ctx.menu);
  return {
    小计: formatCents(pricing.subtotalCents),
    ...(fulfillment === "DELIVERY"
      ? { 运费: formatCents(pricing.deliveryFeeCents), 合计: formatCents(pricing.totalCents) }
      : {}),
  };
}

function getMenuTool(ctx: ToolContext) {
  const refs = productRefs(ctx.menu);
  return {
    orderingEnabled: ctx.menu.orderingEnabled,
    maxQtyPerItem: ctx.menu.maxQtyPerItem,
    products: [...refs].map(([ref, p]) => publicProduct(ctx.menu, p, ref)),
  };
}

function checkDateTool(ctx: ToolContext, raw: unknown) {
  const args = CheckDateArgs.parse(raw);
  const r = resolveItems(ctx, args.items);
  if (!r.ok) return { error: r.error };
  if (!ctx.availability.orderingEnabled) return { date: args.date, state: "CLOSED", meaning: "现在暂停接单" };
  const plan = planCart(inputFor(ctx, r.lines, args.fulfillment), args.date);
  if (!plan) {
    return { date: args.date, state: "NOT_OFFERED", meaning: "这一天不开放预订（或不在可订范围内）" };
  }
  const problems = problemsOf(ctx, r.lines);
  return {
    date: args.date,
    label: dayLabel(args.date),
    state: problems.length ? "PROBLEM" : plan.state,
    meaning: problems.length ? problems.join("；") : STATE_TEXT[plan.state],
    ...(problems.length ? {} : priceFor(ctx, r.lines, args.fulfillment ?? ctx.fulfillment)),
    ...(plan.state === "AVAILABLE" && !problems.length ? { cutoff: cutoffText(ctx, r.lines, args.date) } : {}),
    ...(plan.hints.length ? { 办法: plan.hints.map((h) => hintView(ctx, h)) } : {}),
  };
}

function findDatesTool(ctx: ToolContext, raw: unknown) {
  const args = FindDatesArgs.parse(raw);
  const r = resolveItems(ctx, args.items);
  if (!r.ok) return { error: r.error };
  if (!ctx.availability.orderingEnabled) return { dates: [], meaning: "现在暂停接单" };
  const problems = problemsOf(ctx, r.lines);
  if (problems.length) return { dates: [], meaning: problems.join("；") };
  const result = listAvailability(inputFor(ctx, r.lines, args.fulfillment));
  const dates = result.dates
    .filter((d) => d.state === "AVAILABLE")
    .slice(0, 5)
    .map((d) => ({ date: d.date, label: dayLabel(d.date), cutoff: d.cutoffLabel }));
  return dates.length ? { dates } : { dates, meaning: "最近没有能订下这些的日子，可以少订一些或换别的面包" };
}

function proposeCartTool(ctx: ToolContext, raw: unknown) {
  const args = ProposeArgs.parse(raw);
  const r = resolveItems(ctx, args.items);
  if (!r.ok) return { error: r.error };
  const problems = problemsOf(ctx, r.lines);
  if (problems.length) return { error: problems.join("；") };
  const date = args.date ?? null;
  if (date) {
    const plan = ctx.availability.orderingEnabled ? planCart(inputFor(ctx, r.lines, undefined), date) : null;
    if (!plan || plan.state !== "AVAILABLE") {
      return { error: `${date} 订不了这些（${plan ? STATE_TEXT[plan.state] : "不开放预订"}），换一天或不填日期` };
    }
  }
  ctx.suggestion = { items: r.lines, date, note: plainText(scrubPii(args.note), NOTE_MAX) };
  return {
    ok: true,
    说明: "已经给顾客看建议卡片了，顾客自己点「放进纸袋」再下单",
    ...priceFor(ctx, r.lines, ctx.fulfillment),
  };
}

/**
 * Runs one tool call. Always returns a JSON-serialisable object; bad arguments come back
 * as `{ error }` so the model can correct itself (never an exception to the caller).
 */
export function runTool(ctx: ToolContext, name: string, argsJson: string): unknown {
  let raw: unknown;
  try {
    raw = argsJson.trim() === "" ? {} : JSON.parse(argsJson);
  } catch {
    return { error: "参数不是合法的 JSON" };
  }
  try {
    switch (name) {
      case "get_menu":
        return getMenuTool(ctx);
      case "check_date":
        return checkDateTool(ctx, raw);
      case "find_dates":
        return findDatesTool(ctx, raw);
      case "propose_cart":
        return proposeCartTool(ctx, raw);
      default:
        return { error: `没有这个工具：${plainText(name, 40)}` };
    }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { error: `参数不对：${e.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("；")}` };
    }
    throw e;
  }
}
