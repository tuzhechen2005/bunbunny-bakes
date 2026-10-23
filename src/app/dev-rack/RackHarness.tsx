"use client";

import { FlyLayer } from "@/components/customer/bag/FlyLayer";
import { Rack } from "@/components/customer/rack/Rack";
import { useMenu } from "@/components/customer/useMenu";
import { cart, useCart } from "@/lib/cart";

export function RackHarness() {
  const { menu } = useMenu();
  const items = useCart();
  const count = items.reduce((sum, i) => sum + i.qty, 0);
  return (
    <main className="mx-auto w-full max-w-xl py-6">
      {menu ? (
        <Rack
          products={menu.products}
          maxQty={menu.maxQtyPerItem}
          cart={items}
          onAdd={(id) => cart.increment(id, menu.maxQtyPerItem)}
        />
      ) : null}
      <p className="mt-6 text-center text-sm" data-testid="bar-count">
        {count}
      </p>
      <FlyLayer />
    </main>
  );
}
