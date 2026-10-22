// Pricing (CAPACITY_RULES.md §2). Pure functions; all money is integer cents.
import type { Cents, FeeSettings, Fulfillment, PriceSnapshot } from "./types";

function assertCents(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer (cents), got ${value}`);
  }
}

function assertQty(qty: number): void {
  if (!Number.isInteger(qty) || qty < 1) {
    throw new RangeError(`qty must be a positive integer, got ${qty}`);
  }
}

function assertPrice(price: PriceSnapshot): void {
  assertCents(price.unitPriceCents, "unitPriceCents");
  if (price.bundlePriceCents !== null) assertCents(price.bundlePriceCents, "bundlePriceCents");
  if (!Number.isInteger(price.bundleSize) || price.bundleSize < 1) {
    throw new RangeError(`bundleSize must be an integer >= 1, got ${price.bundleSize}`);
  }
}

function assertFees(fees: FeeSettings): void {
  assertCents(fees.deliveryFeeCents, "deliveryFeeCents");
  assertCents(fees.freeDeliveryMinCents, "freeDeliveryMinCents");
}

/**
 * Total for one product line:
 * floor(qty / bundleSize) * bundlePrice + (qty % bundleSize) * unitPrice,
 * or qty * unitPrice when the product has no bundle (bundlePriceCents null).
 */
export function lineTotal(qty: number, price: PriceSnapshot): Cents {
  assertQty(qty);
  assertPrice(price);
  if (price.bundlePriceCents === null) return qty * price.unitPriceCents;
  const bundles = Math.floor(qty / price.bundleSize);
  const rest = qty % price.bundleSize;
  return bundles * price.bundlePriceCents + rest * price.unitPriceCents;
}

/** Delivery fee: charged only for DELIVERY when subtotal < freeDeliveryMinCents. */
export function deliveryFee(subtotal: Cents, fulfillment: Fulfillment, fees: FeeSettings): Cents {
  assertCents(subtotal, "subtotal");
  assertFees(fees);
  return fulfillment === "DELIVERY" && subtotal < fees.freeDeliveryMinCents ? fees.deliveryFeeCents : 0;
}

export interface PricedLine {
  productId: string;
  qty: number;
  price: PriceSnapshot;
}

export interface CartPricing {
  lines: { productId: string; qty: number; lineTotalCents: Cents }[];
  subtotalCents: Cents;
  deliveryFeeCents: Cents;
  totalCents: Cents;
  /** max(0, freeDeliveryMinCents - subtotal), computed regardless of fulfillment. */
  freeDeliveryGapCents: Cents;
}

/**
 * Prices a whole cart. Each line is priced on its own: bundles never mix
 * across products.
 *
 * Callers must merge lines first: if the same productId appears in more than
 * one line this throws an Error, because pricing split lines separately would
 * miss bundles (e.g. 2 + 2 would not get the 4-piece price).
 */
export function priceCart(lines: PricedLine[], fulfillment: Fulfillment, fees: FeeSettings): CartPricing {
  assertFees(fees);
  const seen = new Set<string>();
  const priced = lines.map((line) => {
    if (seen.has(line.productId)) {
      throw new Error(`duplicate productId in cart: ${line.productId} (merge lines before pricing)`);
    }
    seen.add(line.productId);
    return { productId: line.productId, qty: line.qty, lineTotalCents: lineTotal(line.qty, line.price) };
  });
  const subtotalCents = priced.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const deliveryFeeCents = deliveryFee(subtotalCents, fulfillment, fees);
  return {
    lines: priced,
    subtotalCents,
    deliveryFeeCents,
    totalCents: subtotalCents + deliveryFeeCents,
    freeDeliveryGapCents: Math.max(0, fees.freeDeliveryMinCents - subtotalCents),
  };
}

/** 1398 → "$13.98". No thousands separator. */
export function formatCents(c: Cents): string {
  assertCents(c, "cents");
  const dollars = Math.floor(c / 100);
  const rest = String(c % 100).padStart(2, "0");
  return `$${dollars}.${rest}`;
}
