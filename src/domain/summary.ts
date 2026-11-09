// Nightly production summary data (docs/CAPACITY_RULES.md §10, docs/NOTIFICATIONS.md §4).
// Pure: returns data only; `today` is a parameter. Email text lives elsewhere.

import { doughUsed } from "./capacity";
import { addDays } from "./dates";
import {
  OCCUPYING_STATUSES,
  type CapacityProduct,
  type CartLine,
  type DayLimits,
  type DayOrder,
  type LocalDate,
} from "./types";

export interface SummaryProduct extends CapacityProduct {
  name: string;
  unitLabel: string;
  sortOrder: number;
  batchYield: number | null;
  flavors?: readonly { id: string }[];
}

export interface SummaryOrder extends DayOrder {
  orderNo: string;
  wechatId: string;
}

export interface SummaryDay {
  date: LocalDate;
  isOpen: boolean;
  limits: DayLimits;
  orders: SummaryOrder[];
}

export interface SummaryInput {
  /** X */
  today: LocalDate;
  /** May contain X+1 and X+2; a missing day = not an open date, no orders. */
  days: Record<LocalDate, SummaryDay>;
  /** ALL products incl. paused/archived. */
  products: Record<string, SummaryProduct>;
}

export interface FlavorQuantity {
  flavorId: string | null;
  flavorName: string | null;
  qty: number;
}

export interface BreadLine {
  flavors?: FlavorQuantity[];
  productId: string;
  name: string;
  unitLabel: string;
  qty: number;
  rounds: { rounds: number; leftover: number } | null;
}

export interface BatchLine {
  flavors?: FlavorQuantity[];
  productId: string;
  name: string;
  unitLabel: string;
  qty: number;
  batches: number | null;
  leftover: number | null;
}

export interface UnconfirmedOrder {
  orderNo: string;
  wechatId: string;
  status: "NEW" | "CONTACTED";
  pickupDate: LocalDate;
}

export interface DailySummary {
  today: LocalDate;
  tomorrow: LocalDate;
  dayAfter: LocalDate;
  /** null ⇔ "明天没有开放" (X+1 not open and no occupying orders). */
  bread: { lines: BreadLine[]; doughG: number; doughLimitG: number } | null;
  /** INDEPENDENT products picked up X+1 (made tonight). */
  tonight: { date: LocalDate; lines: BatchLine[] };
  /** INDEPENDENT products picked up X+2 (just cut off). */
  tomorrowNight: { date: LocalDate; lines: BatchLine[] };
  /** X+1 orders. */
  deliveries: { pickup: number; delivery: number };
  /** X+1 and X+2. */
  unconfirmed: UnconfirmedOrder[];
  isEmpty: boolean;
}

type ProductMap = Record<string, SummaryProduct>;
type ProductionDay = Omit<SummaryDay, "orders"> & { orders: DayOrder[] };

export interface DayProduction {
  bread: BreadLine[];
  independent: BatchLine[];
  /** Ordered pieces, excluding extra pieces from rounding up rounds/batches. */
  totalPieces: number;
  orderCount: number;
  /** D38: NEW + CONTACTED, consistent with the daily email reminder. */
  unconfirmedCount: number;
}

function isPositiveInt(n: number | null): n is number {
  return n !== null && Number.isInteger(n) && n > 0;
}

function lookup(products: ProductMap, productId: string): SummaryProduct {
  const product = Object.prototype.hasOwnProperty.call(products, productId)
    ? products[productId]
    : undefined;
  if (!product) throw new Error(`summary: unknown productId "${productId}"`);
  return product;
}

function getDay(input: SummaryInput, date: LocalDate): SummaryDay | undefined {
  const d = Object.prototype.hasOwnProperty.call(input.days, date) ? input.days[date] : undefined;
  if (d && d.date !== date) {
    throw new Error(`summary: days key "${date}" does not match day.date "${d.date}"`);
  }
  return d;
}

function occupyingOrders(day: ProductionDay | undefined): DayOrder[] {
  return day ? day.orders.filter((o) => OCCUPYING_STATUSES.includes(o.status)) : [];
}

/** Day totals per product over the given (already filtered) orders, qty > 0 only. */
function totalsOf(orders: DayOrder[], products: ProductMap): Map<string, number> {
  const totals = new Map<string, number>();
  for (const order of orders) {
    for (const line of order.items) {
      if (line.stockLotId) continue;
      lookup(products, line.productId);
      totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.qty);
    }
  }
  for (const [id, qty] of totals) if (!(qty > 0)) totals.delete(id);
  return totals;
}

/** Snapshot names survive renames and deactivation; null remains explicit legacy data. */
export function flavorQuantities(lines: readonly CartLine[]): FlavorQuantity[] {
  const totals = new Map<string, FlavorQuantity>();
  for (const line of lines) {
    const key = JSON.stringify([line.flavorId ?? null, line.flavorName ?? null]);
    const old = totals.get(key);
    if (old) old.qty += line.qty;
    else totals.set(key, { flavorId: line.flavorId ?? null, flavorName: line.flavorName ?? null, qty: line.qty });
  }
  return [...totals.values()].sort((a, b) => {
    const left = a.flavorName ?? "";
    const right = b.flavorName ?? "";
    return (left < right ? -1 : left > right ? 1 : 0) || (a.flavorId ?? "").localeCompare(b.flavorId ?? "");
  });
}

function flavorSection(orders: DayOrder[], product: SummaryProduct): { flavors?: FlavorQuantity[] } {
  const lines = orders.flatMap(o => o.items).filter(l => !l.stockLotId && l.productId === product.id);
  return product.flavors?.length || lines.some(l => l.flavorId)
    ? { flavors: flavorQuantities(lines) } : {};
}

function compareProducts(a: SummaryProduct, b: SummaryProduct): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sortedEntries(
  totals: Map<string, number>,
  products: ProductMap,
  keep: (p: SummaryProduct) => boolean,
): { product: SummaryProduct; qty: number }[] {
  return [...totals]
    .map(([id, qty]) => ({ product: lookup(products, id), qty }))
    .filter((e) => keep(e.product))
    .sort((a, b) => compareProducts(a.product, b.product));
}

const isDoughMode = (p: SummaryProduct) =>
  p.capacityMode === "DOUGH_PER_UNIT" || p.capacityMode === "DOUGH_PER_ROUND";
const isIndependent = (p: SummaryProduct) => p.capacityMode === "INDEPENDENT";

function breadSection(day: ProductionDay | undefined, products: ProductMap): DailySummary["bread"] {
  const orders = occupyingOrders(day);
  if (!day || (!day.isOpen && orders.length === 0)) return null;

  const lines: BreadLine[] = sortedEntries(totalsOf(orders, products), products, isDoughMode).map(
    ({ product, qty }) => {
      let rounds: BreadLine["rounds"] = null;
      if (product.capacityMode === "DOUGH_PER_ROUND") {
        const per = product.piecesPerRound;
        if (!isPositiveInt(per)) {
          throw new Error(`summary: DOUGH_PER_ROUND product "${product.id}" needs piecesPerRound`);
        }
        const n = Math.ceil(qty / per);
        rounds = { rounds: n, leftover: n * per - qty };
      }
      return { productId: product.id, name: product.name, unitLabel: product.unitLabel, ...flavorSection(orders, product), qty, rounds };
    },
  );

  return {
    lines,
    doughG: doughUsed(orders, products),
    doughLimitG: day.limits.doughLimitG,
  };
}

function batchLines(day: ProductionDay | undefined, products: ProductMap): BatchLine[] {
  const orders = occupyingOrders(day);
  const reserved = day?.limits.poolReservations ?? [];
  const productionOrders: DayOrder[] = [...orders, { id: 'converted-stock', status: 'CONFIRMED', fulfillment: 'PICKUP', items: reserved }];
  const totals = totalsOf(orders, products);
  for (const line of reserved) if (line.qty > 0 && !totals.has(line.productId)) totals.set(line.productId, 0);
  return sortedEntries(totals, products, isIndependent).map(({ product, qty }) => {
    const y = product.batchYield;
    if (!isPositiveInt(y)) {
      return { productId: product.id, name: product.name, unitLabel: product.unitLabel, ...flavorSection(orders, product), qty, batches: null, leftover: null };
    }
    const pools = new Map<string, number>();
    for (const o of productionOrders) for (const l of o.items) if (!l.stockLotId && l.productId === product.id) pools.set(l.flavorId ?? "", (pools.get(l.flavorId ?? "") ?? 0) + l.qty);
    const batches = product.saleMode === "GROUP" ? [...pools.values()].reduce((n,qty)=>n+Math.ceil(qty/y),0) : Math.ceil(qty / y);
    return { productId: product.id, name: product.name, unitLabel: product.unitLabel, ...flavorSection(orders, product), qty, batches, leftover: batches * y - (product.saleMode === "GROUP" ? [...pools.values()].reduce((n, pieces) => n + pieces, 0) : qty) };
  });
}

/** Calendar production uses exactly the same lines and rounding as the daily email. */
export function buildDayProduction(day: ProductionDay | undefined, products: ProductMap): DayProduction {
  const orders = occupyingOrders(day);
  const bread = breadSection(day, products)?.lines ?? [];
  const independent = batchLines(day, products);
  return {
    bread,
    independent,
    totalPieces: [...bread, ...independent].reduce((total, line) => total + line.qty, 0),
    orderCount: orders.length,
    unconfirmedCount: orders.filter((o) => o.status === "NEW" || o.status === "CONTACTED").length,
  };
}

function unconfirmedOf(day: SummaryDay | undefined, date: LocalDate): UnconfirmedOrder[] {
  if (!day) return [];
  const result: UnconfirmedOrder[] = [];
  for (const o of day.orders) {
    if (o.status === "NEW" || o.status === "CONTACTED") {
      result.push({ orderNo: o.orderNo, wechatId: o.wechatId, status: o.status, pickupDate: date });
    }
  }
  return result;
}

export function buildSummary(input: SummaryInput): DailySummary {
  const { today, products } = input;
  const tomorrow = addDays(today, 1);
  const dayAfter = addDays(today, 2);
  const d1 = getDay(input, tomorrow);
  const d2 = getDay(input, dayAfter);

  const bread = breadSection(d1, products);
  const tonight = { date: tomorrow, lines: batchLines(d1, products) };
  const tomorrowNight = { date: dayAfter, lines: batchLines(d2, products) };

  const d1Orders = occupyingOrders(d1);
  const deliveries = {
    pickup: d1Orders.filter((o) => o.fulfillment === "PICKUP").length,
    delivery: d1Orders.filter((o) => o.fulfillment === "DELIVERY").length,
  };

  // Sorted by pickupDate (tomorrow before dayAfter), then orderNo.
  const byOrderNo = (a: UnconfirmedOrder, b: UnconfirmedOrder) =>
    a.orderNo < b.orderNo ? -1 : a.orderNo > b.orderNo ? 1 : 0;
  const unconfirmed = [
    ...unconfirmedOf(d1, tomorrow).sort(byOrderNo),
    ...unconfirmedOf(d2, dayAfter).sort(byOrderNo),
  ];

  const isEmpty =
    (bread === null || bread.lines.length === 0) &&
    tonight.lines.length === 0 &&
    tomorrowNight.lines.length === 0 &&
    unconfirmed.length === 0;

  return { today, tomorrow, dayAfter, bread, tonight, tomorrowNight, deliveries, unconfirmed, isEmpty };
}
