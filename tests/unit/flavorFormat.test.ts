import { describe, expect, it } from "vitest";
import { cartLineTotal, flavorBundleText } from "@/components/customer/format";
import type { MenuProduct } from "@/lib/api";

const product = {
  id: "p", unitPriceCents: 400, bundleSize: 4, bundlePriceCents: null,
  flavors: [
    { id: "a", name: "抹茶", priceCents: 450, bundlePriceCents: 1600 },
    { id: "b", name: "原味", priceCents: 400, bundlePriceCents: null },
  ],
} as unknown as MenuProduct;

describe("F2 flavour display", () => {
  it("shows the bundle line only for a flavour with a bundle price", () => {
    expect(flavorBundleText(product, product.flavors![0])).toBe("4 个 $16.00");
    expect(flavorBundleText(product, product.flavors![1])).toBeNull();
  });
  it("prices a flavour line with its own bundle", () => {
    expect(cartLineTotal({ qty: 5, flavorId: "a" }, product)).toBe(1600 + 450);
    expect(cartLineTotal({ qty: 5, flavorId: "b" }, product)).toBe(2000);
  });
});
