"use client";

import Image from "next/image";
import { useRef } from "react";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import type { MenuProduct } from "@/lib/api";
import { isOwnPhoto, PHOTO_SIZES, type PhotoVariant } from "@/lib/photo";
import { BunnyPlaceholder } from "./BunnyPlaceholder";
import { fill } from "./format";

const t = copy.customer.home;

/** Intrinsic size given to next/image (only sets the aspect ratio; CSS sets the displayed size). */
const PHOTO_INTRINSIC = 1200;

/** The photos of a product in display order, cover first (older payloads without `images` have just the cover). */
export function photosOf(p: Pick<MenuProduct, "imageUrl"> & { images?: readonly string[] | null }): string[] {
  if (p.images && p.images.length > 0) return [...p.images];
  return p.imageUrl ? [p.imageUrl] : [];
}

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
  src,
  priority = false,
  eager = false,
  decorative = false,
}: {
  product: MenuProduct;
  className: string;
  variant: PhotoVariant;
  /** Show this photo instead of the cover (a carousel slide, the rope's back face). */
  src?: string | null;
  priority?: boolean;
  eager?: boolean;
  /** The surrounding element already carries the product name (alt="" then). */
  decorative?: boolean;
}) {
  const url = src === undefined ? product.imageUrl : src;
  if (!url) return <BunnyPlaceholder className={className} />;
  return (
    <Image
      src={url}
      alt={decorative ? "" : product.name}
      // Photos are 1:1 (D72); object-cover handles any other shape.
      width={PHOTO_INTRINSIC}
      height={PHOTO_INTRINSIC}
      sizes={PHOTO_SIZES[variant]}
      // Only our own photos go through the optimizer (next.config.ts allows just /api/images/**).
      unoptimized={!isOwnPhoto(url)}
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

/**
 * Grid tile of the "all breads" list (FRONTEND.md 4.1 item 5, D97): the whole tile is one button that
 * opens the detail (there is no add here). `from` is the photo's rect, where the detail grows out of.
 */
export function ProductCard({
  product,
  onOpen,
}: {
  product: MenuProduct;
  onOpen?: (from: DOMRect, opener: HTMLElement, via: "key" | "pointer") => void;
}) {
  const photo = useRef<HTMLSpanElement>(null);
  const paused = product.status === "PAUSED";
  return (
    <li
      className={`hm-tile ${paused ? "is-paused" : ""}`}
      data-testid="product-card"
      data-product-id={product.id}
      data-paused={paused ? "true" : undefined}
    >
      <button
        type="button"
        className="hm-tile-btn"
        aria-label={fill(t.viewDetail, { name: product.name })}
        onClick={(e) =>
          onOpen?.(
            photo.current?.getBoundingClientRect() ?? e.currentTarget.getBoundingClientRect(),
            e.currentTarget,
            e.detail === 0 ? "key" : "pointer",
          )
        }
        data-testid="tile-photo"
      >
        <span className="hm-ph" ref={photo}>
          <span className="hm-ph-img">
            <ProductPhoto product={product} className="h-full w-full" variant="grid" decorative />
          </span>
        </span>
        <span className="hm-t-name">{product.name}</span>
        <span className="hm-t-p">
          <b className="hm-n" data-testid="price">
            {formatCents(product.unitPriceCents)}
          </b>
          {product.bundlePriceCents !== null ? (
            <small data-testid="bundle-price">
              {fill(t.bundlePrice, { size: product.bundleSize, price: formatCents(product.bundlePriceCents) })}
            </small>
          ) : null}
        </span>
        {paused ? <span className="hm-t-note">{t.paused}</span> : null}
      </button>
    </li>
  );
}
