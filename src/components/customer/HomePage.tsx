"use client";

import Link from "next/link";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import type { MenuProduct } from "@/lib/api";
import { cart, useCart } from "@/lib/cart";
import { fill, safeLineTotal } from "./format";
import { ProductCard } from "./ProductCard";
import { SiteFooter } from "./SiteFooter";
import { useMenu } from "./useMenu";

const t = copy.customer.home;

export function HomePage() {
  const { status, menu, reload } = useMenu();
  const items = useCart();

  const byId = new Map<string, MenuProduct>((menu?.products ?? []).map((p) => [p.id, p]));
  const known = items.filter((i) => byId.has(i.productId));
  const count = known.reduce((sum, i) => sum + i.qty, 0);
  const subtotal = known.reduce((sum, i) => sum + safeLineTotal(i.qty, byId.get(i.productId)!), 0);
  const orderingEnabled = menu?.orderingEnabled ?? false;

  return (
    <div className="flex flex-1 flex-col">
      <header className="px-4 pt-6 pb-3">
        <h1 className="text-2xl font-bold">{copy.shopName}</h1>
        {menu ? (
          menu.orderingEnabled ? (
            <p className="mt-1 text-sm text-accent-strong" data-testid="ordering-state">
              {copy.home.orderingOpen}
            </p>
          ) : (
            <div className="mt-1 text-sm" data-testid="ordering-state">
              <p className="font-medium">{copy.home.orderingClosed}</p>
              <p className="text-muted">{t.orderingClosedHint}</p>
            </div>
          )
        ) : null}
      </header>

      <main className="flex-1 px-4 pb-28">
        {status === "loading" ? <p className="py-10 text-center text-muted">{t.loading}</p> : null}
        {status === "error" ? (
          <div className="py-10 text-center">
            <p role="alert" className="text-danger">
              {t.loadFailed}
            </p>
            <button
              type="button"
              className="mt-3 min-h-11 rounded-full border border-accent px-5 text-accent"
              onClick={reload}
            >
              {t.retry}
            </button>
          </div>
        ) : null}
        {menu && menu.products.length === 0 ? (
          <p className="py-10 text-center text-muted">{t.emptyMenu}</p>
        ) : null}
        {menu ? (
          <ul className="flex flex-col gap-3">
            {menu.products.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                qty={items.find((i) => i.productId === p.id)?.qty ?? 0}
                max={menu.maxQtyPerItem}
                onDecrease={() => cart.decrement(p.id)}
                onIncrease={() => {
                  if (p.status !== "PAUSED") cart.increment(p.id, menu.maxQtyPerItem);
                }}
              />
            ))}
          </ul>
        ) : null}
        {menu ? <SiteFooter ownerWechatId={menu.ownerWechatId} /> : null}
      </main>

      <div
        className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
        data-testid="cart-bar"
      >
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted" data-testid="bar-count">
              {fill(t.barCount, { count })}
            </p>
            <p className="text-lg font-semibold tabular-nums" data-testid="bar-subtotal">
              {fill(t.barSubtotal, { amount: formatCents(subtotal) })}
            </p>
          </div>
          {orderingEnabled && count > 0 ? (
            <Link
              href="/checkout"
              className="flex min-h-12 items-center rounded-full bg-accent px-6 text-base font-semibold text-accent-ink active:bg-accent-strong"
              data-testid="go-checkout"
            >
              {t.goCheckout}
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="min-h-12 rounded-full bg-disabled px-6 text-base font-semibold text-disabled-ink"
              data-testid="go-checkout"
            >
              {menu && !orderingEnabled ? t.checkoutClosed : t.goCheckout}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
