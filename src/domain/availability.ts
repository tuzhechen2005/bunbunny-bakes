// Date availability for a cart (CAPACITY_RULES.md §7, §7.1). Pure: `now` is a parameter.

import { checkDay } from "./capacity";
import { cutoffAt as computeCutoffAt, cutoffLabel, isBeforeCutoff, leadDaysOf } from "./cutoff";
import { addDays, compareLocalDate, localDateOf } from "./dates";
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

/** Customers see open dates up to this many days after today (API_SPEC POST /api/availability). */
const VISIBLE_DAYS = 60;
/** leadDays used when the cart has no known products. */
const DEFAULT_LEAD_DAYS = 1;

export type DateState = "AVAILABLE" | "CUTOFF" | "FULL" | "DELIVERY_FULL";

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

export function listAvailability(input: AvailabilityInput): AvailabilityResult {
  const problems = cartProblems(input.cart, input.products, input.maxQtyPerItem);
  if (!input.orderingEnabled) {
    return { orderingEnabled: false, cartProblems: problems, dates: [] };
  }
  const dates = visibleDays(input).map((day): DateEntry => {
    const { state, cutoffAt } = evaluateDay(input, day);
    return { date: day.date, state, cutoffAt, cutoffLabel: cutoffLabel(cutoffAt) };
  });
  return { orderingEnabled: true, cartProblems: problems, dates };
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
