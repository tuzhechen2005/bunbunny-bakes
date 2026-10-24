// Bookkeeping (D87). Pure: no Prisma, no clock. Everything is integer cents.
//
// Rules (PAGES.md /admin/ledger):
// - Orders count on their pickup date; CANCELLED / REJECTED orders count nowhere.
// - A paid order adds its total (delivery fee included) to revenue and to its payment
//   method; a paid order with no method recorded goes to its own bucket UNSPECIFIED
//   (「未注明」, D94), separate from a deliberate OTHER. An unpaid valid order adds its
//   total to "receivable".
// - Quantities come only from paid orders and from the items typed into manual entries.
// - Per-product amount = sum of the paid orders' actual line totals. Bundle prices were
//   applied per order when it was placed; they are never re-applied to a summed quantity.
// - Manual entries add their amount to revenue and to their payment method. Their items
//   add quantity only (the amount is one lump sum, so no per-product amount).

import { isLocalDate } from "./dates";
import type { LocalDate, OrderStatus } from "./types";

export const LEDGER_METHODS = ["WECHAT", "ZELLE", "VENMO", "CASH", "OTHER"] as const;
export type LedgerMethod = (typeof LEDGER_METHODS)[number];
/** Where a paid amount is booked: a payment method, or UNSPECIFIED for a paid order with none recorded. */
export const LEDGER_BUCKETS = [...LEDGER_METHODS, "UNSPECIFIED"] as const;
export type LedgerBucket = (typeof LEDGER_BUCKETS)[number];

export interface LedgerOrderItem {
  productId: string;
  name: string;
  qty: number;
  lineTotalCents: number;
}

export interface LedgerOrder {
  orderNo: string;
  wechatId: string;
  pickupDate: LocalDate;
  status: OrderStatus;
  paid: boolean;
  paidMethod: LedgerMethod | null;
  totalCents: number;
  deliveryFeeCents: number;
  items: LedgerOrderItem[];
}

export interface LedgerManualItem {
  productId: string | null;
  name: string;
  qty: number;
}

export interface LedgerManualEntry {
  id: string;
  date: LocalDate;
  amountCents: number;
  note: string;
  paidMethod: LedgerMethod;
  items: LedgerManualItem[];
}

export type MethodTotals = Record<LedgerBucket, number>;

export interface ProductTotal {
  /** Null for manual items without a product link; those group by name. */
  productId: string | null;
  name: string;
  qty: number;
  /** Paid orders' actual line totals; manual items add quantity only. */
  amountCents: number;
}

export interface LedgerTotals {
  revenueCents: number;
  qty: number;
  deliveryFeeCents: number;
  receivableCents: number;
  byMethod: MethodTotals;
}

export interface DayOrderRow {
  orderNo: string;
  wechatId: string;
  items: LedgerOrderItem[];
  totalCents: number;
  deliveryFeeCents: number;
  paid: boolean;
  /** Null when unpaid; UNSPECIFIED when paid without a recorded method. */
  method: LedgerBucket | null;
}

export interface DayDetail extends LedgerTotals {
  date: LocalDate;
  orders: DayOrderRow[];
  manual: LedgerManualEntry[];
  products: ProductTotal[];
}

export interface MonthDay {
  date: LocalDate;
  revenueCents: number;
  qty: number;
  receivableCents: number;
}

export interface MonthSummary extends LedgerTotals {
  month: string;
  days: MonthDay[];
}

export function emptyMethodTotals(): MethodTotals {
  return { WECHAT: 0, ZELLE: 0, VENMO: 0, CASH: 0, OTHER: 0, UNSPECIFIED: 0 };
}

export function isValidOrder(o: Pick<LedgerOrder, "status">): boolean {
  return o.status !== "CANCELLED" && o.status !== "REJECTED";
}

const orderQty = (o: LedgerOrder) => o.items.reduce((s, i) => s + i.qty, 0);
const manualQty = (m: LedgerManualEntry) => m.items.reduce((s, i) => s + i.qty, 0);

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function totalsOf(orders: LedgerOrder[], manual: LedgerManualEntry[]): LedgerTotals {
  const t: LedgerTotals = {
    revenueCents: 0,
    qty: 0,
    deliveryFeeCents: 0,
    receivableCents: 0,
    byMethod: emptyMethodTotals(),
  };
  for (const o of orders) {
    if (!isValidOrder(o)) continue;
    if (o.paid) {
      t.revenueCents += o.totalCents;
      t.deliveryFeeCents += o.deliveryFeeCents;
      t.qty += orderQty(o);
      t.byMethod[o.paidMethod ?? "UNSPECIFIED"] += o.totalCents;
    } else {
      t.receivableCents += o.totalCents;
    }
  }
  for (const m of manual) {
    t.revenueCents += m.amountCents;
    t.qty += manualQty(m);
    t.byMethod[m.paidMethod] += m.amountCents;
  }
  return t;
}

function productTotals(orders: LedgerOrder[], manual: LedgerManualEntry[]): ProductTotal[] {
  const map = new Map<string, ProductTotal>();
  const add = (productId: string | null, name: string, qty: number, amountCents: number) => {
    const key = productId ?? `name:${name}`;
    const cur = map.get(key);
    if (cur) {
      cur.qty += qty;
      cur.amountCents += amountCents;
    } else {
      map.set(key, { productId, name, qty, amountCents });
    }
  };
  for (const o of orders) {
    if (!isValidOrder(o) || !o.paid) continue;
    for (const i of o.items) add(i.productId, i.name, i.qty, i.lineTotalCents);
  }
  for (const m of manual) for (const i of m.items) add(i.productId, i.name, i.qty, 0);
  return [...map.values()].sort((a, b) => compareText(a.name, b.name));
}

/** One day: orders and manual entries whose date is `date`; anything else is ignored. */
export function dayDetail(
  date: LocalDate,
  orders: LedgerOrder[],
  manual: LedgerManualEntry[],
): DayDetail {
  const dayOrders = orders.filter((o) => o.pickupDate === date && isValidOrder(o));
  const dayManual = manual.filter((m) => m.date === date);
  const rows: DayOrderRow[] = [...dayOrders]
    .sort((a, b) => compareText(a.orderNo, b.orderNo))
    .map((o) => ({
      orderNo: o.orderNo,
      wechatId: o.wechatId,
      items: o.items,
      totalCents: o.totalCents,
      deliveryFeeCents: o.deliveryFeeCents,
      paid: o.paid,
      method: o.paid ? (o.paidMethod ?? "UNSPECIFIED") : null,
    }));
  return {
    date,
    ...totalsOf(dayOrders, dayManual),
    orders: rows,
    manual: [...dayManual].sort((a, b) => compareText(a.id, b.id)),
    products: productTotals(dayOrders, dayManual),
  };
}

/** First and last day of "YYYY-MM". Throws on anything else. */
export function monthBounds(month: string): { first: LocalDate; last: LocalDate } {
  const first = `${month}-01`;
  if (!/^\d{4}-\d{2}$/.test(month) || !isLocalDate(first)) {
    throw new Error(`Invalid month: ${JSON.stringify(month)}`);
  }
  // Day 0 of the following month is this month's last day.
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  return { first, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** The previous / next "YYYY-MM". */
export function shiftMonth(month: string, delta: number): string {
  const { first } = monthBounds(month);
  const y = Number(first.slice(0, 4));
  const idx = y * 12 + (Number(first.slice(5, 7)) - 1) + delta;
  return `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Month view: totals plus one row per day that has any valid order or manual entry. */
export function monthSummary(
  month: string,
  orders: LedgerOrder[],
  manual: LedgerManualEntry[],
): MonthSummary {
  const { first, last } = monthBounds(month);
  const inMonth = (d: LocalDate) => d >= first && d <= last; // fixed-width ISO dates sort as text
  const mo = orders.filter((o) => inMonth(o.pickupDate) && isValidOrder(o));
  const mm = manual.filter((m) => inMonth(m.date));
  const dates = new Set<LocalDate>([...mo.map((o) => o.pickupDate), ...mm.map((m) => m.date)]);
  const days: MonthDay[] = [...dates].sort().map((date) => {
    const t = totalsOf(
      mo.filter((o) => o.pickupDate === date),
      mm.filter((m) => m.date === date),
    );
    return { date, revenueCents: t.revenueCents, qty: t.qty, receivableCents: t.receivableCents };
  });
  return { month, ...totalsOf(mo, mm), days };
}
