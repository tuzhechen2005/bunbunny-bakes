"use client";

import { useRef } from "react";
import { copy } from "@/copy";
import type { MenuProduct } from "@/lib/api";
import { BunnyPlaceholder } from "./BunnyPlaceholder";
import { priceText } from "./format";
import { QtyStepper } from "./QtyStepper";

const t = copy.customer.home;
const b = copy.customer.brand;

export function ProductPhoto({ product, className }: { product: MenuProduct; className: string }) {
  if (!product.imageUrl) return <BunnyPlaceholder className={className} />;
  return (
    // Product photos are served by /api/images (Netlify Blobs); a plain <img> avoids image-optimizer config.
    // The caller's className fixes the box size, so lazy loading does not shift the layout.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={product.imageUrl} alt={product.name} className={`${className} aspect-square object-cover`} loading="lazy" decoding="async" />
  );
}

/**
 * One row of the 「全部面包」 list (FRONTEND.md 4.1). This list is the accessible fallback path:
 * plain buttons, no gestures. `onIncrease` receives the thumbnail's rect so the caller can fly it to the bag.
 */
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
  onIncrease: (from: DOMRect | null) => void;
}) {
  const photo = useRef<HTMLDivElement>(null);
  const paused = product.status === "PAUSED";
  const atMax = qty >= max;
  const canIncrease = !paused && !atMax;
  const increase = () => onIncrease(photo.current?.getBoundingClientRect() ?? null);
  return (
    <li
      className="flex gap-4 border-b border-line py-4 first:pt-0"
      data-testid="product-card"
      data-product-id={product.id}
      data-paused={paused ? "true" : undefined}
    >
      <div ref={photo} className={`h-24 w-24 shrink-0 ${paused ? "opacity-60 grayscale" : ""}`}>
        <ProductPhoto product={product} className="h-24 w-24 overflow-hidden rounded-sm" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className={`font-serif text-lg leading-snug break-words ${paused ? "text-muted" : ""}`}>{product.name}</h3>
          {paused ? (
            <span className="shrink-0 rounded-full bg-soft px-2 py-0.5 text-xs text-muted">{t.paused}</span>
          ) : null}
        </div>
        {product.description ? <p className="text-sm leading-relaxed break-words text-muted">{product.description}</p> : null}
        <p className="text-sm font-medium text-accent-strong" data-testid="price">
          {priceText(product)}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <QtyStepper qty={qty} canIncrease={canIncrease} onDecrease={onDecrease} onIncrease={increase} />
          <button
            type="button"
            disabled={!canIncrease}
            onClick={increase}
            className="min-h-11 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink transition-colors active:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:bg-disabled disabled:text-disabled-ink"
            data-testid="add-to-bag"
          >
            {b.addToBag}
          </button>
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
