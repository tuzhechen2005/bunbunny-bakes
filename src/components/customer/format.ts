// Display helpers for customer pages. Display only: the payable total always comes from the server.

import { copy } from "@/copy";
import { formatCents, lineTotal } from "@/domain/pricing";
import type { MenuProduct } from "@/lib/api";

/** Replaces {key} placeholders. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** "$5" for whole dollars, otherwise "$5.02". */
export function formatDollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : formatCents(cents);
}

/** "$2.49 / 个　4 个 $8.99" (no bundle part when the product has no bundle). */
export function priceText(p: MenuProduct): string {
  const unit = fill(copy.customer.home.unitPrice, { price: formatCents(p.unitPriceCents) });
  if (p.bundlePriceCents === null) return unit;
  const bundle = fill(copy.customer.home.bundlePrice, {
    size: p.bundleSize,
    price: formatCents(p.bundlePriceCents),
  });
  return `${unit}${copy.customer.home.priceSeparator}${bundle}`;
}

/** Display-only line total; 0 for invalid input instead of throwing. */
export function safeLineTotal(qty: number, p: MenuProduct): number {
  try {
    return lineTotal(qty, p);
  } catch {
    return 0;
  }
}

/** "$10.99 + $2.99 = $13.98", or just "$13.98" when there is only one part. */
export function breakdownText(qty: number, p: MenuProduct): string {
  const total = safeLineTotal(qty, p);
  if (p.bundlePriceCents === null || p.bundleSize < 1) return formatCents(total);
  const bundlesCents = Math.floor(qty / p.bundleSize) * p.bundlePriceCents;
  const restCents = (qty % p.bundleSize) * p.unitPriceCents;
  if (bundlesCents === 0 || restCents === 0) return formatCents(total);
  return `${formatCents(bundlesCents)} + ${formatCents(restCents)} = ${formatCents(total)}`;
}
