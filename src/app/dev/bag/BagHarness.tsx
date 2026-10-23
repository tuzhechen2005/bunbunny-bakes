"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { BagBar } from "@/components/customer/bag/BagBar";
import { FlyLayer } from "@/components/customer/bag/FlyLayer";
import { safeLineTotal } from "@/components/customer/format";
import type { MenuProduct } from "@/lib/api";
import { cart, useCart } from "@/lib/cart";
import { flyToBag } from "@/lib/flyToBag";

// Test stand-in for the home page (see page.tsx). Query: ?closed=1 (ordering closed),
// ?compact=1 (detail open), ?nophoto=1 (products without photos), ?max=N (max per item).
const PRODUCTS: MenuProduct[] = [
  ["hd", "奶酥红豆包", 249, 899, 1],
  ["rs", "岩烧乳酪包", 249, 899, 1],
  ["nj", "奶酪角", 299, 1099, 1],
  ["bl", "焦糖布蕾", 249, 899, 2],
].map(([id, name, unit, bundle, lead]) => ({
  id: id as string,
  name: name as string,
  description: null,
  imageUrl: `/test-photos/${id}.jpg`,
  unitPriceCents: unit as number,
  bundleSize: 4,
  bundlePriceCents: bundle as number,
  status: "ACTIVE" as const,
  leadDays: lead as number,
}));

export function BagHarness() {
  const q = useSearchParams();
  const closed = q.get("closed") === "1";
  const compact = q.get("compact") === "1";
  const noPhoto = q.get("nophoto") === "1";
  const max = Number(q.get("max") ?? 20);
  // ?late=1: the menu photos arrive only after the "late-photos" button (menu after the cart).
  const late = q.get("late") === "1";
  const [photosIn, setPhotosIn] = useState(false);
  const products = noPhoto || (late && !photosIn) ? PRODUCTS.map((p) => ({ ...p, imageUrl: null })) : PRODUCTS;

  const items = useCart();
  const [checkedOut, setChecked] = useState(0);
  const known = items.filter((i) => products.some((p) => p.id === i.productId));
  const count = known.reduce((s, i) => s + i.qty, 0);
  const subtotal = known.reduce((s, i) => s + safeLineTotal(i.qty, products.find((p) => p.id === i.productId)!), 0);

  const add = (p: MenuProduct, n: number, el: HTMLElement) => {
    const have = items.find((i) => i.productId === p.id)?.qty ?? 0;
    const room = Math.max(0, Math.min(n, max - have));
    if (room === 0) return;
    cart.setQty(p.id, have + room, max);
    flyToBag({ from: el.getBoundingClientRect(), imageUrl: p.imageUrl, productId: p.id, count: room });
  };

  return (
    <div className="mx-auto min-h-svh max-w-[430px] bg-field p-5 pb-40 text-fink">
      <h1 className="font-display text-3xl">bag harness</h1>
      <div className="mt-4 grid grid-cols-2 gap-4">
        {products.map((p) => (
          <div key={p.id} className="rounded bg-c-paper p-3 text-c-ink">
            <div
              className="aspect-square rounded bg-c-wash bg-cover"
              style={p.imageUrl ? { backgroundImage: `url(${p.imageUrl})` } : undefined}
              data-testid={`photo-${p.id}`}
            />
            <div className="mt-2 text-sm font-bold">{p.name}</div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="h-11 min-w-11 rounded-full bg-c-ink px-3 text-c-paper"
                data-testid={`add-${p.id}`}
                onClick={(e) => add(p, 1, e.currentTarget.parentElement!.parentElement!.firstElementChild as HTMLElement)}
              >
                +1
              </button>
              <button
                type="button"
                className="h-11 min-w-11 rounded-full bg-c-ink px-3 text-c-paper"
                data-testid={`add3-${p.id}`}
                onClick={(e) => add(p, 3, e.currentTarget.parentElement!.parentElement!.firstElementChild as HTMLElement)}
              >
                +3
              </button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="mt-6 h-11 rounded bg-c-paper px-4 text-c-ink" data-testid="clear-cart" onClick={() => cart.clear()}>
        clear
      </button>
      <button type="button" className="mt-2 h-11 rounded bg-c-paper px-4 text-c-ink" data-testid="late-photos" onClick={() => setPhotosIn(true)}>
        photos
      </button>
      <p data-testid="checkout-calls">{checkedOut}</p>
      <FlyLayer />
      <BagBar
        products={products}
        maxQty={max}
        cart={items}
        count={count}
        subtotalCents={subtotal}
        orderingEnabled={!closed}
        onIncrease={(id) => cart.increment(id, max)}
        onDecrease={(id) => cart.decrement(id)}
        onCheckout={() => setChecked((n) => n + 1)}
        compact={compact}
      />
    </div>
  );
}
