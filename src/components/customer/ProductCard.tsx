"use client";

import { useRef } from "react";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import type { MenuProduct } from "@/lib/api";
import { BunnyPlaceholder } from "./BunnyPlaceholder";
import { fill } from "./format";
import { PlusIcon } from "./rack/icons";
import { QtyStepper } from "./QtyStepper";

const t = copy.customer.home;

/**
 * Product photo, or the faint-logo tile when there is none. The caller's className fixes the
 * box size (so lazy loading never shifts the layout); `eager` skips lazy loading (first rope photo).
 */
export function ProductPhoto({
  product,
  className,
  eager = false,
  decorative = false,
}: {
  product: MenuProduct;
  className: string;
  eager?: boolean;
  /** The surrounding element already carries the product name (alt="" then). */
  decorative?: boolean;
}) {
  if (!product.imageUrl) return <BunnyPlaceholder className={className} />;
  return (
    // Product photos are served by /api/images (Netlify Blobs); a plain <img> avoids image-optimizer config.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={product.imageUrl}
      alt={decorative ? "" : product.name}
      className={`${className} aspect-square object-cover`}
      loading={eager ? undefined : "lazy"}
      decoding="async"
      draggable={false}
    />
  );
}

/** Grid tile of the "all breads" list (FRONTEND.md 4.1 item 5): photo, round "+" that becomes "− n +". */
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
  /** `from` is the photo's rect, where the little flight to the bag starts. */
  onIncrease: (from: DOMRect | null) => void;
}) {
  const photo = useRef<HTMLDivElement>(null);
  const paused = product.status === "PAUSED";
  const atMax = qty >= max;
  const add = () => onIncrease(photo.current?.getBoundingClientRect() ?? null);
  return (
    <li
      className={`hm-tile ${paused ? "is-paused" : ""}`}
      data-testid="product-card"
      data-product-id={product.id}
      data-paused={paused ? "true" : undefined}
    >
      <div className="hm-ph" ref={photo}>
        <div className="hm-ph-img">
          <ProductPhoto product={product} className="h-full w-full" />
        </div>
        <span className="hm-ctl">
          {qty > 0 ? (
            <QtyStepper qty={qty} canIncrease={!paused && !atMax} onDecrease={onDecrease} onIncrease={add} onPhoto />
          ) : (
            <button type="button" className="hm-plus" aria-label={t.increase} disabled={paused || atMax} onClick={add}>
              <PlusIcon />
            </button>
          )}
        </span>
      </div>
      <h3 className="hm-t-name">{product.name}</h3>
      <p className="hm-t-p">
        <b className="hm-n" data-testid="price">
          {formatCents(product.unitPriceCents)}
        </b>
        {product.bundlePriceCents !== null ? (
          <small data-testid="bundle-price">
            {fill(t.bundlePrice, { size: product.bundleSize, price: formatCents(product.bundlePriceCents) })}
          </small>
        ) : null}
      </p>
      {paused ? <p className="hm-t-note">{t.paused}</p> : null}
      {!paused && atMax ? (
        <p className="hm-t-note is-warn" data-testid="max-hint">
          {t.maxReached}
        </p>
      ) : null}
    </li>
  );
}
