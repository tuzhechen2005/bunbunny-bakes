import { copy } from "@/copy";
import type { FlavorQuantity } from "@/domain/summary";

/** Unit comes from the caller's existing rendering context. */
export function flavorSummaryText(name: string, flavors: FlavorQuantity[], qty: number, unit = ""): string {
  const lines = flavors.filter(f => f.flavorName != null)
    .map(f => `${f.flavorName} ${f.qty}${unit}`);
  const otherQty = flavors.filter(f => f.flavorName == null).reduce((total, f) => total + f.qty, 0);
  if (otherQty > 0) lines.push(`${copy.flavors.other} ${otherQty}${unit}`);
  const values: Record<string, string | number> = {
    name, qty, unit,
    flavors: lines.join("、"),
  };
  return copy.flavors.summary.replace(/\{(\w+)\}/g, (whole, key: string) => String(values[key] ?? whole));
}
