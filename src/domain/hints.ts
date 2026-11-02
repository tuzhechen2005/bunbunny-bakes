// Actionable hints for a FULL or WEEKDAY date (D116, CAPACITY_RULES §7.2). Pure.
//
// Hints carry cart quantities only: never grams, limits, used or remaining amounts.
// Whether a cart "fits" a date is always decided by the injected `stateOf` (the real
// availability rules); the search below only proposes candidates.
//
// Complexity of the sub-cart search: an exact dynamic programme over "pieces kept",
// O(n · K²) worst case for n lines and K pieces in the cart (each line has ≤ q_i + 1
// choices, Σ q_i = K), O(K) working memory. Carts above MAX_HINT_PIECES get no hints, so the
// work per date is bounded no matter what the request contains.

import type { DateState, OpenDay } from "./availability";
import { productDough, effectiveFlavorLimit, flavorUsage } from "./capacity";
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
  /** The merged cart (one line per product/flavour, cart order), known products only, non-empty. */
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
  const usedFlavors = flavorUsage(day.orders);
  // Inputs are merged by product/flavour before hint search; bound each flavour first.
  cart = cart.map(line => {
    const limit = line.flavorId ? effectiveFlavorLimit(products[line.productId], line.flavorId, day.limits) : null;
    return { ...line, qty: limit === null ? line.qty : Math.min(line.qty, Math.max(0, limit - (usedFlavors[line.flavorId!] ?? 0))) };
  });
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

  // Capacity belongs to a product, even when its flavour lines are interleaved.
  // Each group offers a total quantity; the dough cost rounds the merged day total once.
  const groups = new Map<string, { min: number; max: number; weight: number[] }>();
  for (const line of cart) {
    const group = groups.get(line.productId) ?? { min: 0, max: 0, weight: [] };
    group.max += line.qty;
    groups.set(line.productId, group);
  }
  for (const [id, group] of groups) {
    const product = products[id];
    const ex = existing.get(id) ?? 0;
    const limit = has(day.limits.productLimits, id) ? day.limits.productLimits[id] : (product.dailyLimit ?? 0);
    const cap = product.capacityMode === "INDEPENDENT"
      ? Math.max(0, limit - ex) : doughBlocked ? 0 : group.max;
    const base = productDough(product, ex);
    group.weight = Array.from({ length: group.max + 1 }, (_, qty) =>
      qty > cap ? Infinity : productDough(product, ex + qty) - base);
  }
  const total = pieces(cart);
  // Minimum dough for each total count under already fixed line choices.
  const costs = (exclude?: string): number[] => {
    let best = new Array<number>(total + 1).fill(Infinity);
    best[0] = 0;
    let bound = 0;
    for (const [id, group] of groups) {
      if (id === exclude) continue;
      const next = new Array<number>(total + 1).fill(Infinity);
      for (let k = 0; k <= bound; k++) {
        if (!Number.isFinite(best[k])) continue;
        for (let qty = group.min; qty <= group.max; qty++) {
          next[k + qty] = Math.min(next[k + qty], best[k] + group.weight[qty]);
        }
      }
      bound += group.max;
      best = next;
    }
    return best;
  };
  const initial = costs();
  let target = total;
  while (target > 0 && initial[target] > budget) target--;
  const keep: number[] = [];
  // Fix original lines from first to last, keeping as many as possible while a completion
  // remains feasible. This preserves the original tie rule even for A/B/A flavour order.
  for (const line of cart) {
    const group = groups.get(line.productId)!;
    const other = costs(line.productId);
    let chosen = 0;
    for (let s = line.qty; s >= 0; s--) {
      let fits = false;
      for (let qty = group.min + s; qty <= group.max - line.qty + s && qty <= target; qty++) {
        if (group.weight[qty] + other[target - qty] <= budget) { fits = true; break; }
      }
      if (fits) { chosen = s; break; }
    }
    keep.push(chosen);
    group.min += chosen;
    group.max -= line.qty - chosen;
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
  const here = cart.flatMap((l, i) => (keep[i] > 0 ? [{ ...l, qty: keep[i] }] : []));
  const rest = cart.flatMap((l, i) => (keep[i] < l.qty ? [{ ...l, qty: l.qty - keep[i] }] : []));
  // Empty: nothing fits. The real rules decide (e.g. delivery full, or a formula mismatch).
  if (here.length === 0 || rest.length === 0 || input.stateOf(here, day) !== "AVAILABLE") return [];

  const hints: DateHint[] = [{ kind: "REDUCE", remove: rest }];
  const restDate = nearestRestDate(input, rest);
  if (restDate !== null) hints.push({ kind: "SPLIT", reason: "CAPACITY", here, rest, restDate });
  return hints;
}
