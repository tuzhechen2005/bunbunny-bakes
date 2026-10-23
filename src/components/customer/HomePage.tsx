"use client";

import { useRouter } from "next/navigation";
import { BunnyMark } from "@/components/brand/BunnyMark";
import { BlurText } from "@/components/reactbits/BlurText";
import { copy } from "@/copy";
import type { MenuProduct } from "@/lib/api";
import { cart, useCart } from "@/lib/cart";
import { flyToBag } from "@/lib/flyToBag";
import { BagBar } from "./bag/BagBar";
import { FlyLayer } from "./bag/FlyLayer";
import { safeLineTotal } from "./format";
import { ProductCard } from "./ProductCard";
import { Rack } from "./rack/Rack";
import { SiteFooter } from "./SiteFooter";
import { useMenu } from "./useMenu";

const t = copy.customer.home;
const b = copy.customer.brand;

/** Quiet state block: bunny mark + one line (loading, empty, error). */
function QuietState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center text-muted">
      <BunnyMark size={44} />
      {children}
    </div>
  );
}

export function HomePage() {
  const router = useRouter();
  const { status, menu, reload } = useMenu();
  const items = useCart();

  const byId = new Map<string, MenuProduct>((menu?.products ?? []).map((p) => [p.id, p]));
  const known = items.filter((i) => byId.has(i.productId));
  const count = known.reduce((sum, i) => sum + i.qty, 0);
  const subtotal = known.reduce((sum, i) => sum + safeLineTotal(i.qty, byId.get(i.productId)!), 0);
  const orderingEnabled = menu?.orderingEnabled ?? false;

  /** Put one more in the bag now (cart updates at click time) and fly the thumbnail there. */
  const add = (p: MenuProduct, from: DOMRect | null) => {
    if (!menu || p.status === "PAUSED") return;
    cart.increment(p.id, menu.maxQtyPerItem);
    // Rack items give no rect; fall back to the rack photo, then to the list row.
    const el =
      document.querySelector(`[data-testid="rack-item"][data-product-id="${p.id}"]`) ??
      document.querySelector(`[data-testid="product-card"][data-product-id="${p.id}"]`);
    const rect = from ?? el?.getBoundingClientRect() ?? null;
    if (rect) flyToBag({ from: rect, imageUrl: p.imageUrl, productId: p.id });
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col">
        <header className="px-4 pt-6 pb-2">
          <h1 className="flex items-center gap-2 font-serif text-xl" aria-label={copy.shopName}>
            <BunnyMark size={30} />
            <span aria-hidden="true">{t.wordmark}</span>
          </h1>
          {menu ? (
            menu.orderingEnabled ? (
              <p className="mt-2 text-sm text-accent-strong" data-testid="ordering-state">
                {copy.home.orderingOpen}
              </p>
            ) : (
              <div className="mt-2 text-sm" data-testid="ordering-state">
                <p className="font-medium">{copy.home.orderingClosed}</p>
                <p className="text-muted">{t.orderingClosedHint}</p>
              </div>
            )
          ) : null}
        </header>

        <section className="px-4 pt-6 pb-6">
          <p className="font-serif text-3xl leading-tight">
            <BlurText text={b.slogan} />
          </p>
          <p className="mt-3 text-base text-muted">{b.subLine}</p>
        </section>

        <main className="flex-1 pb-32">
          {status === "loading" ? (
            <QuietState>
              <p>{t.loading}</p>
            </QuietState>
          ) : null}
          {status === "error" ? (
            <QuietState>
              <p role="alert" className="text-danger">
                {t.loadFailed}
              </p>
              <button
                type="button"
                className="min-h-11 rounded-full border border-accent px-6 text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onClick={reload}
              >
                {t.retry}
              </button>
            </QuietState>
          ) : null}
          {menu && menu.products.length === 0 ? (
            <QuietState>
              <p>{t.emptyMenu}</p>
            </QuietState>
          ) : null}
          {menu && menu.products.length > 0 ? (
            <>
              <div className="px-4">
                <Rack
                  products={menu.products}
                  maxQty={menu.maxQtyPerItem}
                  cart={items}
                  onAdd={(id) => {
                    const p = byId.get(id);
                    if (p) add(p, null);
                  }}
                />
              </div>
              <section className="mt-12 px-4" aria-label={b.listTitle}>
                <h2 className="mb-4 font-serif text-xl">{b.listTitle}</h2>
                <ul className="flex flex-col">
                  {menu.products.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      qty={items.find((i) => i.productId === p.id)?.qty ?? 0}
                      max={menu.maxQtyPerItem}
                      onDecrease={() => cart.decrement(p.id)}
                      onIncrease={(from) => add(p, from)}
                    />
                  ))}
                </ul>
              </section>
            </>
          ) : null}
          {menu ? (
            <div className="px-4">
              <SiteFooter ownerWechatId={menu.ownerWechatId} />
            </div>
          ) : null}
        </main>
      </div>

      <BagBar
        count={count}
        subtotalCents={subtotal}
        disabled={!orderingEnabled || count === 0}
        onCheckout={() => router.push("/checkout")}
      />
      <FlyLayer />
    </div>
  );
}
