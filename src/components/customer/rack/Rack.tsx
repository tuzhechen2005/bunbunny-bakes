"use client";

import { copy } from "@/copy";
import type { MenuProduct } from "@/lib/api";
import type { CartItem } from "@/lib/cart";
import { priceText } from "../format";
import { ProductPhoto } from "../ProductCard";

const t = copy.customer.home;
const b = copy.customer.brand;

export interface RackProps {
  /** Menu products in display order (the server already orders them). */
  products: readonly MenuProduct[];
  /** Max quantity per item (Menu.maxQtyPerItem). */
  maxQty: number;
  cart: readonly CartItem[];
  /** Put one more into the bag. The caller updates the cart (cart.increment) and may fly to bag. */
  onAdd: (productId: string) => void;
  /** Open the product detail ("take it off the rope"). Optional until the detail task lands. */
  onOpenDetail?: (productId: string) => void;
}

/**
 * STUB (task f0): horizontal placeholder with the FINAL props. The rope-rack task replaces the
 * body (rope, pegs, pendulum, swipe) and must keep these props.
 */
export function Rack({ products, maxQty, cart, onAdd, onOpenDetail }: RackProps) {
  return (
    <section aria-label={b.rackTitle} data-testid="rack">
      <h2 className="font-serif text-xl">{b.rackTitle}</h2>
      <ul className="mt-3 flex gap-4 overflow-x-auto pb-2">
        {products.map((p) => {
          const qty = cart.find((i) => i.productId === p.id)?.qty ?? 0;
          const paused = p.status === "PAUSED";
          return (
            <li
              key={p.id}
              className={`w-40 shrink-0 ${paused ? "opacity-60 grayscale" : ""}`}
              data-testid="rack-item"
              data-product-id={p.id}
            >
              <button type="button" className="block w-full" onClick={() => onOpenDetail?.(p.id)}>
                <ProductPhoto product={p} className="w-full overflow-hidden rounded-md" />
                <span className="mt-2 block text-left font-serif text-base">{p.name}</span>
              </button>
              <p className="text-sm text-accent-strong">{paused ? t.paused : priceText(p)}</p>
              <button
                type="button"
                disabled={paused || qty >= maxQty}
                className="mt-1 min-h-11 w-full rounded-full bg-accent px-4 text-accent-ink disabled:bg-disabled disabled:text-disabled-ink"
                onClick={() => onAdd(p.id)}
              >
                {b.addToBag}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
