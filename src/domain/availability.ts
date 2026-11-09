// Date availability for a cart (CAPACITY_RULES.md §7, §7.1). Pure: `now` is a parameter.

import { mergeCartLines } from "./cart";
import { checkDay } from "./capacity";
import { cutoffAt as computeCutoffAt, cutoffLabel, isBeforeCutoff, leadDaysOf } from "./cutoff";
import { addDays, compareLocalDate, localDateOf } from "./dates";
import { hintsFor, type DateHint } from "./hints";
import type {
  CapacityProduct,
  CartLine,
  DayLimits,
  DayOrder,
  Fulfillment,
  LocalDate,
  ProductStatus,
  Violation,
} from "./types";
import { weekdayViolations } from "./weekdays";

export type { DateHint } from "./hints";

/** Customers see open dates up to this many days after today (API_SPEC POST /api/availability). */
const VISIBLE_DAYS = 60;
/** leadDays used when the cart has no known products. */
const DEFAULT_LEAD_DAYS = 1;

/** Precedence (CAPACITY_RULES §7): CUTOFF > WEEKDAY > FULL > DELIVERY_FULL > AVAILABLE. */
export type DateState = "AVAILABLE" | "CUTOFF" | "WEEKDAY" | "FULL" | "DELIVERY_FULL";

export interface AvailProduct extends CapacityProduct {
  status: ProductStatus;
}

export interface OpenDay {
  failedGroupPools?: { productId: string; flavorId: string | null }[];
  groupPools?: ({ productId: string; flavorId: string | null } & import("./groupPool").PoolProgress)[];
  stockLots?: { lotId: string; productId: string; flavorId: string | null; date: string; left: number; sellUntil: string }[];
  date: LocalDate;
  isOpen: boolean;
  limits: DayLimits;
  orders: DayOrder[];
}

export interface AvailabilityInput {
  now: Date;
  orderingEnabled: boolean;
  cutoffTime: string;
  maxQtyPerItem: number;
  /** ALL products incl. PAUSED/ARCHIVED (old orders reference them). */
  products: Record<string, AvailProduct>;
  cart: CartLine[];
  fulfillment: Fulfillment;
  /** Any order; may include closed / past / far-future days. */
  days: OpenDay[];
}

export type CartProblem = { productId: string; error: "PRODUCT_UNAVAILABLE" | "QTY_LIMIT" };

export interface DayEvaluation {
  state: DateState;
  cutoffAt: Date;
  violations: Violation[];
}

export interface DateEntry {
  groupPools?: OpenDay["groupPools"];
  stockLots?: OpenDay["stockLots"];
  date: LocalDate;
  state: DateState;
  cutoffAt: Date;
  cutoffLabel: string;
  soldOutFlavorIds: string[];
  /** Only on FULL / WEEKDAY dates of a non-empty cart, and only when there is one (§7.2). */
  hints?: DateHint[];
}

/** One date for one cart: what `listAvailability` reports for it. */
export interface DatePlan {
  state: DateState;
  hints: DateHint[];
}

export interface AvailabilityResult {
  orderingEnabled: boolean;
  cartProblems: CartProblem[];
  dates: DateEntry[];
}

function has(products: Record<string, unknown>, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(products, id);
}

/** Rules 3–4: date-independent cart checks. One entry per (productId, error), in cart order. */
export function cartProblems(
  cart: CartLine[],
  products: Record<string, AvailProduct>,
  maxQtyPerItem: number,
): CartProblem[] {
  // Fail closed: NaN/0/fractional would make "total > max" meaningless.
  if (!Number.isInteger(maxQtyPerItem) || maxQtyPerItem < 1) {
    throw new Error(`availability: maxQtyPerItem must be an integer >= 1 (got ${String(maxQtyPerItem)})`);
  }
  const totals = new Map<string, number>();
  for (const line of cart) {
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.qty);
  }
  const problems: CartProblem[] = [];
  for (const [productId, total] of totals) {
    if (!has(products, productId) || products[productId].status !== "ACTIVE") {
      problems.push({ productId, error: "PRODUCT_UNAVAILABLE" });
    }
    if (total > maxQtyPerItem) {
      problems.push({ productId, error: "QTY_LIMIT" });
    }
  }
  return problems;
}

/** Cart lines the date checks consider: unknown productIds are ignored. */
function knownLines(cart: CartLine[], products: Record<string, AvailProduct>): CartLine[] {
  return cart.filter((line) => has(products, line.productId));
}

/** Rules 2, 5–7 for one day (visibility and the ordering switch are not checked here). */
export function evaluateDay(input: AvailabilityInput, day: OpenDay): DayEvaluation {
  const lines = knownLines(input.cart, input.products);
  const preorder = lines.filter(l => !l.stockLotId);
  const leadDays = preorder.length === 0 ? DEFAULT_LEAD_DAYS : leadDaysOf(preorder, input.products);
  let cutoffAt = computeCutoffAt(day.date, leadDays, input.cutoffTime);
  if (lines.length && !preorder.length) {
    const deadlines = lines.map(l => day.stockLots?.find(s => s.lotId === l.stockLotId)?.sellUntil).filter((s): s is string => !!s);
    cutoffAt = deadlines.length === lines.length ? new Date(Math.min(...deadlines.map(s => new Date(s).getTime()))) : input.now;
  }

  if ((day.date === localDateOf(input.now) && preorder.length > 0) || !isBeforeCutoff(input.now, cutoffAt)) {
    return { state: "CUTOFF", cutoffAt, violations: [] };
  }

  const stockQty = new Map<string, number>();
  for (const line of lines) if (line.stockLotId) stockQty.set(line.stockLotId, (stockQty.get(line.stockLotId) ?? 0) + line.qty);
  for (const line of lines) if (line.stockLotId) {
    const lot = day.stockLots?.find(s => s.lotId === line.stockLotId);
    if (!lot || lot.date !== day.date || lot.productId !== line.productId || lot.flavorId !== (line.flavorId ?? null) || input.now >= new Date(lot.sellUntil)) return {state:'CUTOFF',cutoffAt,violations:[]};
    if (stockQty.get(line.stockLotId)! > lot.left) return {state:'FULL',cutoffAt,violations:[]};
  }
  // Rule 2b (D115): every cart product must be available on this weekday.
  const weekday = weekdayViolations(day.date, lines, input.products);
  if (weekday.length > 0) {
    return { state: "WEEKDAY", cutoffAt, violations: weekday };
  }

  if (preorder.some(l => day.failedGroupPools?.some(p => p.productId === l.productId && p.flavorId === (l.flavorId ?? null)) || day.groupPools?.some(p => p.productId === l.productId && p.flavorId === (l.flavorId ?? null) && p.status === 'FAILED'))) return { state: 'FULL', cutoffAt, violations: [] };

  const { violations } = checkDay({
    date: day.date,
    existing: day.orders,
    candidate: { items: lines, fulfillment: input.fulfillment },
    products: input.products,
    limits: day.limits,
  });

  let state: DateState = "AVAILABLE";
  if (violations.some((v) => v.kind === "DOUGH" || v.kind === "PRODUCT")) {
    state = "FULL";
  } else if (violations.some((v) => v.kind === "DELIVERY" || v.kind === "DELIVERY_DISABLED")) {
    state = "DELIVERY_FULL";
  }
  return { state, cutoffAt, violations };
}

/** Rule 1: open days with today < date ≤ today + 60, ascending. */
function visibleDays(input: AvailabilityInput): OpenDay[] {
  const today = localDateOf(input.now);
  const last = addDays(today, VISIBLE_DAYS);
  return input.days
    .filter(
      (d) => d.isOpen && (compareLocalDate(d.date, today) > 0 || (d.date === today && input.cart.some(l => l.stockLotId))) && compareLocalDate(d.date, last) <= 0,
    )
    .sort((a, b) => compareLocalDate(a.date, b.date));
}

/** Merged known lines (one per product/flavour, first-seen order): what hints work on. */
function hintCart(input: AvailabilityInput): CartLine[] {
  return mergeCartLines(knownLines(input.cart, input.products));
}

function planDay(
  input: AvailabilityInput,
  day: OpenDay,
  visible: OpenDay[],
  hasProblems: boolean,
): DatePlan & { cutoffAt: Date } {
  const { state, cutoffAt } = evaluateDay(input, day);
  if (hasProblems || (state !== "FULL" && state !== "WEEKDAY")) return { state, cutoffAt, hints: [] };
  const cart = hintCart(input);
  if (cart.some(l => l.stockLotId || input.products[l.productId]?.saleMode === "GROUP")) return { state, cutoffAt, hints: [] };
  if (cart.length === 0) return { state, cutoffAt, hints: [] };
  const hints = hintsFor({
    cart,
    products: input.products,
    fulfillment: input.fulfillment,
    day,
    state,
    visible,
    stateOf: (sub, d) => evaluateDay({ ...input, cart: sub }, d).state,
  });
  return { state, cutoffAt, hints };
}

/** Capacity-only flags, independent of cart, cutoff and delivery. Never returns counts. */
export function soldOutFlavors(products: Record<string, AvailProduct>, day: OpenDay): string[] {
  return Object.values(products).filter(p => p.status === "ACTIVE").flatMap(p =>
    (p.flavors ?? []).filter(f => f.active !== false && !checkDay({
      date: day.date, existing: day.orders, products, limits: day.limits,
      candidate: { fulfillment: "PICKUP", items: [{ productId: p.id, flavorId: f.id, qty: 1 }] },
    }).ok).map(f => f.id));
}

export function listAvailability(input: AvailabilityInput): AvailabilityResult {
  const problems = cartProblems(input.cart, input.products, input.maxQtyPerItem);
  if (!input.orderingEnabled) {
    return { orderingEnabled: false, cartProblems: problems, dates: [] };
  }
  const visible = visibleDays(input);
  const dates = visible.map((day): DateEntry => {
    const { state, cutoffAt, hints } = planDay(input, day, visible, problems.length > 0);
    const entry: DateEntry = { date: day.date, state, cutoffAt, cutoffLabel: cutoffLabel(cutoffAt), soldOutFlavorIds: soldOutFlavors(input.products, day) };
    const pools = day.groupPools?.filter(p => input.cart.some(l => !l.stockLotId && l.productId === p.productId && (l.flavorId ?? null) === p.flavorId));
    if (pools?.length) entry.groupPools = pools;
    if (day.stockLots?.length) entry.stockLots = day.stockLots;
    if (hints.length > 0) entry.hints = hints;
    return entry;
  });
  return { orderingEnabled: true, cartProblems: problems, dates };
}

/**
 * State and hints of one date for the cart, exactly as `listAvailability` reports them.
 * null when the date is not offered to customers (ordering off, not an open day, or
 * outside today < date ≤ today + 60).
 */
export function planCart(input: AvailabilityInput, date: LocalDate): DatePlan | null {
  const problems = cartProblems(input.cart, input.products, input.maxQtyPerItem);
  if (!input.orderingEnabled) return null;
  const visible = visibleDays(input);
  const day = visible.find((d) => d.date === date);
  if (!day) return null;
  const { state, hints } = planDay(input, day, visible, problems.length > 0);
  return { state, hints };
}

/**
 * §7.1: first visible day strictly after fromDate that satisfies rules 1–7 for the whole cart.
 * A cart with problems (rules 3–4) fits no day, so there is no suggestion.
 */
export function suggestNextDate(input: AvailabilityInput, fromDate: LocalDate): LocalDate | null {
  // Validate first so a bad maxQtyPerItem throws even when ordering is off.
  const problems = cartProblems(input.cart, input.products, input.maxQtyPerItem);
  if (!input.orderingEnabled || problems.length > 0) return null;
  for (const day of visibleDays(input)) {
    if (compareLocalDate(day.date, fromDate) <= 0) continue;
    if (evaluateDay(input, day).state === "AVAILABLE") return day.date;
  }
  return null;
}
