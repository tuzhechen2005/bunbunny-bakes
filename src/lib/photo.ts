// Product photo URLs (D91). Photos are stored once at full size (/api/images/<id>/<hash>.jpg) and
// served resized by Next's image optimizer (`/_next/image`, avif/webp by Accept header; on Netlify
// the runtime maps that URL to the Netlify Image CDN). Pure TS: usable from CSS-background code
// (paper-bag discs, the fly layer) as well as from React.

/** Widths allowed by next.config.ts `images.imageSizes` / `deviceSizes`; any other `w` is refused. */
export const PHOTO_WIDTHS = [128, 192, 256, 384, 480, 640, 750, 900, 1080, 1920] as const;

/** The `quality` next/image asks for by default (next.config.ts `images.qualities`). */
export const PHOTO_QUALITY = 75;

/** The `sizes` attribute of each place a photo is shown (FRONTEND.md 4.1 / 4.2 / 4.4 layouts). */
export const PHOTO_SIZES = {
  /** Rope: the centre card is 54vw wide on phones, 232 px on wider screens. */
  rope: "(max-width: 430px) 54vw, 232px",
  /** Two-column grid. */
  grid: "(max-width: 430px) 46vw, 188px",
  /** Taken-down detail photo. */
  detail: "(max-width: 430px) 76vw, 334px",
  /** Checkout lines and other small photos, never above 64 CSS px. */
  thumb: "64px",
} as const;
export type PhotoVariant = keyof typeof PHOTO_SIZES;

const OURS = "/api/images/";

/** False when the site was built with PHOTO_OPTIMIZE=off (next.config.ts): photos are then served as stored. */
export const PHOTO_OPTIMIZE = process.env.NEXT_PUBLIC_PHOTO_OPTIMIZE !== "off";

/** True for the photos we serve ourselves (the only ones the optimizer is allowed to fetch). */
export function isOwnPhoto(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith(OURS);
}

/**
 * next/image's loader URL for one width: exactly what the `<img srcset>` of a `next/image` uses, so a
 * CSS background and an `<img>` of the same width share one cached file. Anything that is not one of
 * our photos is returned unchanged. `width` snaps up to the nearest allowed width.
 */
export function photoUrl(url: string, width: number): string {
  if (!isOwnPhoto(url) || !PHOTO_OPTIMIZE) return url;
  const w = PHOTO_WIDTHS.find((x) => x >= width) ?? PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1];
  return `/_next/image?url=${encodeURIComponent(url)}&w=${w}&q=${PHOTO_QUALITY}`;
}

/** The same URL as a CSS `url("...")` value (quotes escaped). */
export function photoCssUrl(url: string, width: number): string {
  return `url("${photoUrl(url, width).replace(/"/g, "%22")}")`;
}

/** Flying and stacked discs (CSS backgrounds, shown at most about 40 px): 128 px. */
export const THUMB_WIDTH = 128;
/** Bag rows (62 CSS px, up to 3x): 192 px. */
export const BAG_ROW_WIDTH = 192;
