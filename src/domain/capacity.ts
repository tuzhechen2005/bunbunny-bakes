// Capacity rules (docs/CAPACITY_RULES.md §1, §3, §4, §5, §8). Pure functions only.

import {
  OCCUPYING_STATUSES,
  type CapacityProduct,
  type CartLine,
  type DayLimits,
  type DayOrder,
  type Fulfillment,
  type LocalDate,
  type Usage,
  type Violation,
} from "./types";

export type ProductMap = Record<string, CapacityProduct>;

export interface Candidate {
  items: CartLine[];
  fulfillment: Fulfillment;
}

export interface CheckDayInput {
  date: LocalDate;
  /** All orders of that pickup date, any status. */
  existing: DayOrder[];
  /** The new order, or the new content of an edited order. */
  candidate: Candidate;
  /** Edit: the order's original content is not part of "before". */
  excludeOrderId?: string;
  /** CURRENT product settings. */
  products: ProductMap;
  limits: DayLimits;
}

export interface CheckDayResult {
  ok: boolean;
  before: Usage;
  after: Usage;
  violations: Violation[];
}

function isOccupying(order: DayOrder): boolean {
  return OCCUPYING_STATUSES.includes(order.status);
}

function lookup(products: ProductMap, productId: string): CapacityProduct {
  const product = Object.prototype.hasOwnProperty.call(products, productId)
    ? products[productId]
    : undefined;
  if (!product) throw new Error(`capacity: unknown productId "${productId}"`);
  return product;
}

function assertQty(line: CartLine): void {
  if (!Number.isInteger(line.qty) || line.qty <= 0) {
    throw new Error(
      `capacity: qty must be a positive integer (product "${line.productId}", qty ${line.qty})`,
    );
  }
}

function isPositiveInt(n: number | null): n is number {
  return n !== null && Number.isInteger(n) && n > 0;
}

function isNonNegative(n: number | null): n is number {
  return n !== null && Number.isFinite(n) && n >= 0;
}

/** Day totals per product, summed over the given orders (all assumed to be counted). */
function totalsOf(orders: DayOrder[], products: ProductMap): Map<string, number> {
  const totals = new Map<string, number>();
  for (const order of orders) {
    for (const line of order.items) {
      assertQty(line);
      lookup(products, line.productId);
      totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.qty);
    }
  }
  return totals;
}

/** Dough grams of `total` pieces of one product on one day (0 for INDEPENDENT). */
export function productDough(product: CapacityProduct, total: number): number {
  return doughOfProduct(product, total);
}

function doughOfProduct(product: CapacityProduct, total: number): number {
  switch (product.capacityMode) {
    case "DOUGH_PER_UNIT":
      if (!isNonNegative(product.doughG)) {
        throw new Error(`capacity: DOUGH_PER_UNIT product "${product.id}" needs doughG`);
      }
      return total * product.doughG;
    case "DOUGH_PER_ROUND":
      if (!isNonNegative(product.roundG) || !isPositiveInt(product.piecesPerRound)) {
        throw new Error(
          `capacity: DOUGH_PER_ROUND product "${product.id}" needs roundG and piecesPerRound`,
        );
      }
      // Ceil over the day total, never per order (CAPACITY_RULES §3.2).
      return Math.ceil(total / product.piecesPerRound) * product.roundG;
    case "INDEPENDENT":
      return 0;
    default: {
      // Fail closed: an unknown mode must never yield NaN dough (NaN > limit is false).
      const mode: never = product.capacityMode;
      throw new Error(`capacity: product "${product.id}" has unknown capacityMode "${String(mode)}"`);
    }
  }
}

function isLimit(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

function assertLimit(name: string, n: unknown): number {
  if (!isLimit(n)) {
    throw new Error(`capacity: ${name} must be a finite integer >= 0 (got ${String(n)})`);
  }
  return n;
}

/** Keys must match ids, so usage.products cannot get duplicate or mismatched keys. */
function assertProductMap(products: ProductMap): void {
  for (const [key, product] of Object.entries(products)) {
    if (!product || product.id !== key) {
      throw new Error(`capacity: ProductMap key "${key}" does not match product id "${product?.id}"`);
    }
  }
}

/** Usage of already-filtered (counted) orders. */
function usageOfCounted(orders: DayOrder[], products: ProductMap): Usage {
  assertProductMap(products);
  const totals = totalsOf(orders, products);
  const result: Usage = { doughG: 0, products: {}, deliveries: 0 };

  for (const product of Object.values(products)) {
    if (product.capacityMode === "INDEPENDENT") result.products[product.id] = 0;
  }
  for (const [productId, total] of totals) {
    const product = lookup(products, productId);
    if (product.capacityMode === "INDEPENDENT") {
      result.products[productId] = total;
    } else {
      result.doughG += doughOfProduct(product, total);
    }
  }
  result.deliveries = orders.filter((o) => o.fulfillment === "DELIVERY").length;
  return result;
}

/** Capacity usage of a day. Only occupying orders count. */
export function usage(orders: DayOrder[], products: ProductMap): Usage {
  return usageOfCounted(orders.filter(isOccupying), products);
}

/** Dough grams used by a day. Only occupying orders count. */
export function doughUsed(orders: DayOrder[], products: ProductMap): number {
  return usage(orders, products).doughG;
}

/** Can the candidate fit into this day? Returns every violation it causes. */
export function checkDay(input: CheckDayInput): CheckDayResult {
  const { date, existing, candidate, excludeOrderId, products, limits } = input;

  // Fail closed on malformed limits: a NaN/undefined limit would make every "> limit" false.
  const doughLimitG = assertLimit("doughLimitG", limits.doughLimitG);
  const deliveryLimit = assertLimit("deliveryLimit", limits.deliveryLimit);
  assertProductMap(products);

  // Validate candidate lines up front (unknown product, bad qty).
  for (const line of candidate.items) {
    assertQty(line);
    lookup(products, line.productId);
  }

  const counted = existing.filter(
    (o) => isOccupying(o) && (excludeOrderId === undefined || o.id !== excludeOrderId),
  );
  const candidateOrder: DayOrder = {
    id: "__candidate__",
    status: "NEW",
    fulfillment: candidate.fulfillment,
    items: candidate.items,
  };

  const before = usageOfCounted(counted, products);
  // Always recompute "after" over the whole day.
  const after = usageOfCounted([...counted, candidateOrder], products);

  const violations: Violation[] = [];

  const candidateProductIds = [...new Set(candidate.items.map((l) => l.productId))];
  const touchesDough = candidateProductIds.some(
    (id) => lookup(products, id).capacityMode !== "INDEPENDENT",
  );

  if (touchesDough && after.doughG > doughLimitG) {
    violations.push({
      kind: "DOUGH",
      date,
      limit: doughLimitG,
      after: after.doughG,
      over: after.doughG - doughLimitG,
    });
  }

  for (const productId of candidateProductIds) {
    const product = lookup(products, productId);
    if (product.capacityMode !== "INDEPENDENT") continue;
    const override = Object.prototype.hasOwnProperty.call(limits.productLimits, productId)
      ? limits.productLimits[productId]
      : undefined;
    const resolved = override ?? product.dailyLimit;
    if (resolved === null || resolved === undefined) {
      throw new Error(`capacity: INDEPENDENT product "${productId}" has no daily limit`);
    }
    const limit = assertLimit(`limit of product "${productId}"`, resolved);
    const used = after.products[productId] ?? 0;
    if (used > limit) {
      violations.push({ kind: "PRODUCT", date, productId, limit, after: used, over: used - limit });
    }
  }

  if (candidate.fulfillment === "DELIVERY") {
    if (!limits.deliveryEnabled) {
      violations.push({ kind: "DELIVERY_DISABLED", date });
    } else if (after.deliveries > deliveryLimit) {
      violations.push({
        kind: "DELIVERY",
        date,
        limit: deliveryLimit,
        after: after.deliveries,
        over: after.deliveries - deliveryLimit,
      });
    }
  }

  return { ok: violations.length === 0, before, after, violations };
}
