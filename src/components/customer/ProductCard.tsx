"use client";

import Image from "next/image";
import { useRef } from "react";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import type { MenuProduct } from "@/lib/api";
import { isOwnPhoto, PHOTO_SIZES, type PhotoVariant } from "@/lib/photo";
import { BunnyPlaceholder } from "./BunnyPlaceholder";
import { fill } from "./format";
import { PlusIcon } from "./rack/icons";
import { QtyStepper } from "./QtyStepper";

const t = copy.customer.home;

/** Intrinsic size given to next/image (only sets the aspect ratio; CSS sets the displayed size). */
const PHOTO_INTRINSIC = 1200;

/** Hide a photo that is still loading (see `img[data-ph]` in globals.css), show it with a fade when it has. */
function waitForPhoto(el: HTMLImageElement | null) {
  // A cached or server-rendered photo may already be complete: show it as is.
  if (el && !el.complete) el.dataset.ph = "wait";
}
function photoLoaded(el: HTMLImageElement) {
  el.dataset.ph = "done";
}

/**
 * Product photo, or the faint-logo tile when there is none. Served resized through next/image
 * (D91): `variant` says how wide the photo is shown (sizes), so the browser picks a file of that
 * width. The caller's className fixes the box size (so lazy loading never shifts the layout).
 * Loading: `priority` (the first rope photo: preloaded, fetchpriority high), `eager` (the next
 * one), otherwise lazy. While the file loads the box shows the linen colour and the photo fades
 * in over 350 ms.
 */
export function ProductPhoto({
  product,
  className,
  variant,
  priority = false,
  eager = false,
  decorative = false,
}: {
  product: MenuProduct;
  className: string;
  variant: PhotoVariant;
  priority?: boolean;
  eager?: boolean;
  /** The surrounding element already carries the product name (alt="" then). */
  decorative?: boolean;
}) {
  if (!product.imageUrl) return <BunnyPlaceholder className={className} />;
  return (
    <Image
      src={product.imageUrl}
      alt={decorative ? "" : product.name}
      // Photos are 1:1 (D72); object-cover handles any other shape.
      width={PHOTO_INTRINSIC}
      height={PHOTO_INTRINSIC}
      sizes={PHOTO_SIZES[variant]}
      // Only our own photos go through the optimizer (next.config.ts allows just /api/images/**).
      unoptimized={!isOwnPhoto(product.imageUrl)}
      className={`${className} aspect-square object-cover`}
      preload={priority}
      fetchPriority={priority ? "high" : undefined}
      loading={priority || eager ? "eager" : "lazy"}
      ref={waitForPhoto}
      onLoad={(e) => photoLoaded(e.currentTarget)}
      onError={(e) => photoLoaded(e.currentTarget)}
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
  onOpen,
}: {
  product: MenuProduct;
  qty: number;
  max: number;
  onDecrease: () => void;
  /** `from` is the photo's rect, where the little flight to the bag starts. */
  onIncrease: (from: DOMRect | null) => void;
  /** Tap on the photo: open this bread's detail; `from` is the photo's rect (the detail grows out of it). */
  onOpen?: (from: DOMRect, opener: HTMLElement, via: "key" | "pointer") => void;
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
        <button
          type="button"
          className="hm-ph-img"
          aria-label={fill(t.viewDetail, { name: product.name })}
          onClick={(e) => onOpen?.(e.currentTarget.getBoundingClientRect(), e.currentTarget, e.detail === 0 ? "key" : "pointer")}
          data-testid="tile-photo"
        >
          <ProductPhoto product={product} className="h-full w-full" variant="grid" decorative />
        </button>
        <span className="hm-ctl">
          {qty > 0 ? (
            <QtyStepper
              qty={qty}
              canIncrease={!paused && !atMax}
              onDecrease={onDecrease}
              onIncrease={add}
              onPhoto
              name={product.name}
            />
          ) : (
            <button
              type="button"
              className="hm-plus"
              aria-label={fill(t.increaseNamed, { name: product.name })}
              disabled={paused || atMax}
              onClick={add}
            >
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
