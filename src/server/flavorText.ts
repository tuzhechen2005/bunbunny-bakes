import { copy } from "@/copy";
import type { FlavorQuantity } from "@/domain/summary";

/** Unit comes from the caller's existing rendering context. */
export function flavorSummaryText(name: string, flavors: FlavorQuantity[], qty: number, unit = ""): string {
  const values: Record<string, string | number> = {
    name, qty, unit,
    flavors: flavors.map(f => `${f.flavorName ?? copy.flavors.unspecified} ${f.qty}${unit}`).join("、"),
  };
  return copy.flavors.summary.replace(/\{(\w+)\}/g, (whole, key: string) => String(values[key] ?? whole));
}
