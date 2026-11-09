import type { CartLine } from "./types";

/** Pricing identity; product capacity aggregates by productId; flavour limits also aggregate by flavorId. */
export function lineKey(line: Pick<CartLine, "productId" | "flavorId" | "stockLotId">): string {
  return `${line.productId}:${line.flavorId ?? ""}${line.stockLotId ? `:stock:${line.stockLotId}` : ""}`;
}

export function mergeCartLines(lines: CartLine[]): CartLine[] {
  const merged = new Map<string, CartLine>();
  for (const line of lines) {
    const key = lineKey(line);
    const old = merged.get(key);
    if (old) {
      if (old.ifNotFormed !== line.ifNotFormed) old.ifNotFormed = null;
      old.qty += line.qty;
      // An omitted flavour must never acquire the explicit legacy-null exemption.
      if (line.flavorId === undefined) delete old.flavorId;
    } else merged.set(key, { ...line });
  }
  return [...merged.values()];
}

export function productQuantities(lines: readonly CartLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.qty);
  return totals;
}
