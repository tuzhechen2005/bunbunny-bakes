// Product photo format rules (T5.2): magic-byte sniffing and storage-key validation.
// Pure: no Node-only APIs, so it is unit-testable and safe anywhere.

export type ImageExt = "jpg" | "png" | "webp";
export interface ImageKind {
  ext: ImageExt;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const startsWith = (bytes: Uint8Array, sig: readonly number[], offset = 0) =>
  bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);

/** Detects jpeg / png / webp from the first bytes only; the filename and Content-Type are never trusted. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ext: "jpg", contentType: "image/jpeg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ext: "png", contentType: "image/png" };
  }
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ext: "webp", contentType: "image/webp" };
  }
  return null;
}

/** `<productId uuid>/<32 hex>.<ext>` or `game/<32 hex>.<ext>` (game tier images) and nothing else (also rules out `..`, slashes, case tricks). */
export const IMAGE_KEY_PATTERN = /^(?:[0-9a-f-]{36}|game)\/[0-9a-f]{32}\.(jpg|png|webp)$/;

export function isValidImageKey(key: string): boolean {
  return IMAGE_KEY_PATTERN.test(key);
}

export const IMAGE_URL_PREFIX = "/api/images/";

export function imageUrlForKey(key: string): string {
  return IMAGE_URL_PREFIX + key;
}

/** The storage key behind a Product.imageUrl, or null for anything that is not one of ours. */
export function keyFromImageUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(IMAGE_URL_PREFIX)) return null;
  const key = url.slice(IMAGE_URL_PREFIX.length);
  return isValidImageKey(key) ? key : null;
}
