import { BunnyMark } from "@/components/brand/BunnyMark";
import type { MenuProduct } from "@/lib/api";

/** Square product photo; without a photo, the bunny mark on paper. Fills its (square) parent. */
export function PhotoFace({ product, markSize = 56 }: { product: MenuProduct; markSize?: number }) {
  if (!product.imageUrl) {
    return (
      <span
        className="flex h-full w-full items-center justify-center bg-soft text-muted"
        data-testid="rack-photo-empty"
      >
        <BunnyMark size={markSize} />
      </span>
    );
  }
  return (
    // Product photos come from /api/images; a plain <img> avoids image-optimizer config.
    // The parent fixes the box size, so lazy loading does not shift the layout.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={product.imageUrl}
      alt={product.name}
      draggable={false}
      className="pointer-events-none block h-full w-full object-cover select-none"
      loading="lazy"
      decoding="async"
    />
  );
}
