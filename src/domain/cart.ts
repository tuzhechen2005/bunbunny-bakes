import type { CartLine } from "./types";

/** Pricing identity; capacity always aggregates by productId separately. */
export function lineKey(line: Pick<CartLine, "productId" | "flavorId">): string {
  return `${line.productId}:${line.flavorId ?? ""}`;
}

export function mergeCartLines(lines: CartLine[]): CartLine[] {
  const merged = new Map<string, CartLine>();
  for (const line of lines) {
    const key = lineKey(line);
    const old = merged.get(key);
    if (old) {
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
