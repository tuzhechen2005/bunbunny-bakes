// Date availability for a cart (CAPACITY_RULES.md §7, §7.1). Pure: `now` is a parameter.

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
  date: LocalDate;
  state: DateState;
  cutoffAt: Date;
  cutoffLabel: string;
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
  const leadDays = lines.length === 0 ? DEFAULT_LEAD_DAYS : leadDaysOf(lines, input.products);
  const cutoffAt = computeCutoffAt(day.date, leadDays, input.cutoffTime);

  if (!isBeforeCutoff(input.now, cutoffAt)) {
    return { state: "CUTOFF", cutoffAt, violations: [] };
  }

  // Rule 2b (D115): every cart product must be available on this weekday.
  const weekday = weekdayViolations(day.date, lines, input.products);
  if (weekday.length > 0) {
    return { state: "WEEKDAY", cutoffAt, violations: weekday };
  }

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
      (d) => d.isOpen && compareLocalDate(d.date, today) > 0 && compareLocalDate(d.date, last) <= 0,
    )
    .sort((a, b) => compareLocalDate(a.date, b.date));
}

/** Merged known lines (one per product, first-seen order): what hints work on. */
function hintCart(input: AvailabilityInput): CartLine[] {
  const totals = new Map<string, number>();
  for (const line of knownLines(input.cart, input.products)) {
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.qty);
  }
  return [...totals].map(([productId, qty]) => ({ productId, qty }));
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

export function listAvailability(input: AvailabilityInput): AvailabilityResult {
  const problems = cartProblems(input.cart, input.products, input.maxQtyPerItem);
  if (!input.orderingEnabled) {
    return { orderingEnabled: false, cartProblems: problems, dates: [] };
  }
  const visible = visibleDays(input);
  const dates = visible.map((day): DateEntry => {
    const { state, cutoffAt, hints } = planDay(input, day, visible, problems.length > 0);
    const entry: DateEntry = { date: day.date, state, cutoffAt, cutoffLabel: cutoffLabel(cutoffAt) };
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
