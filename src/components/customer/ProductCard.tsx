"use client";

import { copy } from "@/copy";
import type { MenuProduct } from "@/lib/api";
import { BunnyPlaceholder } from "./BunnyPlaceholder";
import { priceText } from "./format";
import { QtyStepper } from "./QtyStepper";

const t = copy.customer.home;

export function ProductPhoto({ product, className }: { product: MenuProduct; className: string }) {
  if (!product.imageUrl) return <BunnyPlaceholder className={className} />;
  return (
    // Product photos are served by /api/images (Netlify Blobs); a plain <img> avoids image-optimizer config.
    // The caller's className fixes the box size, so lazy loading does not shift the layout.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={product.imageUrl} alt={product.name} className={`${className} aspect-square object-cover`} loading="lazy" decoding="async" />
  );
}

export function ProductCard({
  product,
  qty,
  max,
  onDecrease,
  onIncrease,
}: {
  product: MenuProduct;
  qty: number;
  max: number;
  onDecrease: () => void;
  onIncrease: (anchor: HTMLElement) => void;
}) {
  const paused = product.status === "PAUSED";
  const atMax = qty >= max;
  return (
    <li
      className={`flex gap-3 rounded-2xl border border-line bg-card p-3 ${paused ? "opacity-60 grayscale" : ""}`}
      data-testid="product-card"
      data-product-id={product.id}
      data-paused={paused ? "true" : undefined}
    >
      <ProductPhoto product={product} className="h-20 w-20 shrink-0 overflow-hidden rounded-xl" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold break-words">{product.name}</h2>
          {paused ? (
            <span className="shrink-0 rounded-full bg-soft px-2 py-0.5 text-xs text-muted">{t.paused}</span>
          ) : null}
        </div>
        {product.description ? <p className="text-sm break-words text-muted">{product.description}</p> : null}
        <p className="text-sm font-medium text-accent-strong" data-testid="price">
          {priceText(product)}
        </p>
        <div className="mt-1 flex items-center justify-end">
          <QtyStepper qty={qty} canIncrease={!paused && !atMax} onDecrease={onDecrease} onIncrease={onIncrease} />
        </div>
        {!paused && atMax ? (
          <p className="text-right text-xs text-danger" data-testid="max-hint">
            {t.maxReached}
          </p>
        ) : null}
      </div>
    </li>
  );
}
