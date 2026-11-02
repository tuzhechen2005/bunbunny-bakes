import { flavorPrice } from "@/domain/flavorPricing";
import { lineKey } from "@/domain/cart";
import type { CartLine, PriceSnapshot } from "@/domain/types";
import type { ProductInfo, ProductInfoMap } from "./day";
import type { Tx } from "./db";
import { AppError } from "./errors";

/** Acquire after day/order locks; flavour mutations take the same product lock exclusively. */
export async function lockCartProducts(tx: Tx, cart: CartLine[]): Promise<void> {
  for (const id of [...new Set(cart.map(l => l.productId))].sort()) {
    await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${id}::uuid FOR SHARE`;
  }
}

/** Admin edits may retain inactive stored lines and explicit legacy nulls; ownership is always required. */
export function validateFlavors(
  cart: CartLine[],
  products: ProductInfoMap,
  legacy = new Set<string>(),
  existingLines = new Set<string>(),
): void {
  for (const line of cart) {
    const p = products[line.productId];
    if (!p) continue; // Product validation owns unknown products.
    if (line.flavorId) {
      if (!p.flavors?.some(f => f.id === line.flavorId && (f.active || existingLines.has(lineKey(line))))) {
        throw new AppError("FLAVOR_UNAVAILABLE", { extra: { productId: line.productId, flavorId: line.flavorId } });
      }
    } else if (p.flavors?.some(f => f.active) && !(line.flavorId === null && legacy.has(line.productId))) {
      throw new AppError("FLAVOR_REQUIRED", { extra: { productId: line.productId } });
    }
  }
}

export function currentLinePrice(line: CartLine, p: ProductInfo): { flavorId: string | null; flavorName: string | null; price: PriceSnapshot } {
  const flavor = line.flavorId ? p.flavors?.find(f => f.id === line.flavorId && f.active) : undefined;
  if (line.flavorId && !flavor) throw new AppError("FLAVOR_UNAVAILABLE");
  return {
    flavorId: flavor?.id ?? null,
    flavorName: flavor?.name ?? null,
    price: flavorPrice(p, flavor),
  };
}
