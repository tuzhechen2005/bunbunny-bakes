import type { PriceSnapshot } from "./types";

/** A flavour has its own price/bundle, always using the product bundle size. */
export function flavorPrice(product: PriceSnapshot, flavor?: { priceCents: number; bundlePriceCents?: number | null }): PriceSnapshot {
  return {
    unitPriceCents: flavor ? flavor.priceCents : product.unitPriceCents,
    bundleSize: product.bundleSize,
    bundlePriceCents: flavor ? flavor.bundlePriceCents ?? null : product.bundlePriceCents,
  };
}
