// Actionable hints for a FULL or WEEKDAY date (D116, CAPACITY_RULES §7.2). Pure.
//
// Hints carry cart quantities only: never grams, limits, used or remaining amounts.
// Whether a cart "fits" a date is always decided by the injected `stateOf` (the real
// availability rules); the search below only proposes candidates.
//
// Complexity of the sub-cart search: an exact dynamic programme over "pieces kept",
// O(n · K²) worst case for n lines and K pieces in the cart (each line has ≤ q_i + 1
// choices, Σ q_i = K), O(n · K) memory. Carts above MAX_HINT_PIECES get no hints, so the
// work per date is bounded no matter what the request contains.

import type { DateState, OpenDay } from "./availability";
import { productDough } from "./capacity";
import { compareLocalDate, parseLocalDate } from "./dates";
import { allowsDate } from "./weekdays";
import {
  OCCUPYING_STATUSES,
  type CapacityProduct,
  type CartLine,
  type Fulfillment,
  type LocalDate,
} from "./types";

export type DateHint =
  | { kind: "REDUCE"; remove: CartLine[] }
  | { kind: "SPLIT"; reason: "CAPACITY" | "WEEKDAY"; here: CartLine[]; rest: CartLine[]; restDate: LocalDate | null };

/** Above this many pieces in the cart no hints are computed (keeps the search bounded). */
export const MAX_HINT_PIECES = 300;

export interface HintInput {
  /** The merged cart (one line per product, cart order), known products only, non-empty. */
  cart: CartLine[];
  products: Record<string, CapacityProduct>;
  fulfillment: Fulfillment;
  day: OpenDay;
  /** The day's state for the whole cart (only FULL and WEEKDAY get hints). */
  state: DateState;
  /** All visible days, ascending (restDate candidates). */
  visible: OpenDay[];
  /** State of a day for another cart, under the same rules as `state`. */
  stateOf: (cart: CartLine[], day: OpenDay) => DateState;
}

function has(map: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

function pieces(lines: readonly CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0);
}

/** Days since the epoch, for distances between local dates. */
function dayNumber(d: LocalDate): number {
  const { year, month, day } = parseLocalDate(d);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/**
 * The largest sub-cart (by pieces) that the capacity formulas let into `day`; ties keep the
 * earlier lines whole, i.e. pieces come off the line latest in cart order first.
 * Returns kept quantities per line (same order as `cart`). Delivery is not considered here.
 */
export function largestFittingKeep(
  cart: readonly CartLine[],
  products: Record<string, CapacityProduct>,
  day: OpenDay,
): number[] {
  const counted = day.orders.filter((o) => OCCUPYING_STATUSES.includes(o.status));
  const existing = new Map<string, number>();
  for (const o of counted) {
    for (const l of o.items) existing.set(l.productId, (existing.get(l.productId) ?? 0) + l.qty);
  }
  let baseDough = 0;
  for (const [productId, total] of existing) {
    if (has(products, productId)) baseDough += productDough(products[productId], total);
  }
  let budget = day.limits.doughLimitG - baseDough;
  // Already over the dough limit (owner override): only dough-free sub-carts can fit,
  // because the dough check applies only when the candidate touches dough (§3.3).
  const doughBlocked = budget < 0;
  if (doughBlocked) budget = 0;

  // Per line: the most pieces that may be kept, and the extra dough of keeping s pieces.
  const caps: number[] = [];
  const weights: number[][] = [];
  for (const line of cart) {
    const product = products[line.productId];
    const ex = existing.get(line.productId) ?? 0;
    if (product.capacityMode === "INDEPENDENT") {
      const limit = has(day.limits.productLimits, line.productId)
        ? day.limits.productLimits[line.productId]
        : (product.dailyLimit ?? 0);
      caps.push(Math.max(0, Math.min(line.qty, limit - ex)));
      weights.push(new Array<number>(line.qty + 1).fill(0));
    } else {
      caps.push(doughBlocked ? 0 : line.qty);
      const base = productDough(product, ex);
      weights.push(Array.from({ length: line.qty + 1 }, (_, s) => productDough(product, ex + s) - base));
    }
  }

  // best[i][k] = least extra dough to keep exactly k pieces from lines i..n-1.
  const n = cart.length;
  const total = pieces(cart);
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(total + 1).fill(Infinity));
  best[n][0] = 0;
  for (let i = n - 1; i >= 0; i--) {
    const next = best[i + 1];
    const row = best[i];
    for (let k = 0; k <= total; k++) {
      let min = Infinity;
      for (let s = 0; s <= caps[i] && s <= k; s++) {
        const w = weights[i][s] + next[k - s];
        if (w < min) min = w;
      }
      row[k] = min;
    }
  }

  let k = total;
  while (k > 0 && !(best[0][k] <= budget)) k--;
  const keep: number[] = [];
  let remaining = budget;
  for (let i = 0; i < n; i++) {
    // Keep as much as possible of earlier lines (= remove from the latest line first).
    let s = Math.min(caps[i], k);
    while (s > 0 && !(weights[i][s] + best[i + 1][k - s] <= remaining)) s--;
    keep.push(s);
    remaining -= weights[i][s];
    k -= s;
  }
  return keep;
}

/** Nearest other visible day (|distance|, earlier wins ties) on which `rest` alone is AVAILABLE. */
function nearestRestDate(input: HintInput, rest: CartLine[]): LocalDate | null {
  const here = dayNumber(input.day.date);
  const candidates = input.visible
    .filter((d) => d.date !== input.day.date)
    .map((d) => ({ d, dist: Math.abs(dayNumber(d.date) - here) }))
    .sort((a, b) => a.dist - b.dist || compareLocalDate(a.d.date, b.d.date));
  for (const { d } of candidates) {
    if (input.stateOf(rest, d) === "AVAILABLE") return d.date;
  }
  return null;
}

export function hintsFor(input: HintInput): DateHint[] {
  const { cart, products, day, state } = input;
  if (cart.length === 0 || (state !== "FULL" && state !== "WEEKDAY")) return [];
  if (pieces(cart) > MAX_HINT_PIECES) return [];

  if (state === "WEEKDAY") {
    const here = cart.filter((l) => allowsDate(products[l.productId], day.date));
    const rest = cart.filter((l) => !allowsDate(products[l.productId], day.date));
    if (here.length === 0 || rest.length === 0) return [];
    if (input.stateOf(here, day) !== "AVAILABLE") return [];
    return [{ kind: "SPLIT", reason: "WEEKDAY", here, rest, restDate: nearestRestDate(input, rest) }];
  }

  const keep = largestFittingKeep(cart, products, day);
  const here = cart.flatMap((l, i) => (keep[i] > 0 ? [{ productId: l.productId, qty: keep[i] }] : []));
  const rest = cart.flatMap((l, i) => (keep[i] < l.qty ? [{ productId: l.productId, qty: l.qty - keep[i] }] : []));
  // Empty: nothing fits. The real rules decide (e.g. delivery full, or a formula mismatch).
  if (here.length === 0 || rest.length === 0 || input.stateOf(here, day) !== "AVAILABLE") return [];

  const hints: DateHint[] = [{ kind: "REDUCE", remove: rest }];
  const restDate = nearestRestDate(input, rest);
  if (restDate !== null) hints.push({ kind: "SPLIT", reason: "CAPACITY", here, rest, restDate });
  return hints;
}
