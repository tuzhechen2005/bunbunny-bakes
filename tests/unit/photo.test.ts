import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import { isOwnPhoto, PHOTO_QUALITY, PHOTO_SIZES, PHOTO_WIDTHS, photoCssUrl, photoUrl, THUMB_WIDTH } from "@/lib/photo";

const OURS = "/api/images/0b8d2f5e-1111-4222-8333-444455556666/0123456789abcdef0123456789abcdef.jpg";

describe("photoUrl", () => {
  it("builds next/image's loader URL for one of our photos", () => {
    expect(photoUrl(OURS, 128)).toBe(`/_next/image?url=${encodeURIComponent(OURS)}&w=128&q=${PHOTO_QUALITY}`);
  });

  it("snaps a width up to one the optimizer allows, and caps at the largest", () => {
    expect(photoUrl(OURS, 100)).toContain("&w=128&");
    expect(photoUrl(OURS, 300)).toContain("&w=384&");
    expect(photoUrl(OURS, 99999)).toContain(`&w=${PHOTO_WIDTHS[PHOTO_WIDTHS.length - 1]}&`);
  });

  it("leaves anything that is not one of our photos alone", () => {
    expect(photoUrl("/brand/logo.webp", 128)).toBe("/brand/logo.webp");
    expect(photoUrl("https://example.com/x.jpg", 128)).toBe("https://example.com/x.jpg");
    expect(isOwnPhoto(null)).toBe(false);
    expect(isOwnPhoto(OURS)).toBe(true);
  });

  it("escapes quotes for a CSS url()", () => {
    expect(photoCssUrl(OURS, THUMB_WIDTH)).toBe(`url("${photoUrl(OURS, THUMB_WIDTH)}")`);
    expect(photoCssUrl('/x"y.jpg', 128)).toBe('url("/x%22y.jpg")');
  });
});

describe("next.config images", () => {
  const images = nextConfig.images!;

  it("only optimizes /api/images/** and allows exactly the widths photoUrl can ask for", () => {
    expect(images.localPatterns).toEqual([{ pathname: "/api/images/**" }]);
    const allowed = [...(images.imageSizes ?? []), ...(images.deviceSizes ?? [])].sort((a, b) => a - b);
    expect(allowed).toEqual([...PHOTO_WIDTHS]);
    expect(images.qualities).toContain(PHOTO_QUALITY);
    expect(images.formats).toEqual(["image/avif", "image/webp"]);
  });

  it("has a sizes string for every place a photo is shown", () => {
    expect(Object.keys(PHOTO_SIZES).sort()).toEqual(["detail", "grid", "rope", "thumb"]);
  });
});

describe("PHOTO_OPTIMIZE=off (rollback switch)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("photoUrl hands the original through", async () => {
    vi.stubEnv("NEXT_PUBLIC_PHOTO_OPTIMIZE", "off");
    vi.resetModules();
    const off = await import("@/lib/photo");
    expect(off.PHOTO_OPTIMIZE).toBe(false);
    expect(off.photoUrl(OURS, 128)).toBe(OURS);
    expect(off.photoCssUrl(OURS, 128)).toBe(`url("${OURS}")`);
  });

  it("next.config turns the optimizer off at build time", async () => {
    vi.stubEnv("PHOTO_OPTIMIZE", "off");
    vi.resetModules();
    const cfg = (await import("../../next.config")).default;
    expect(cfg.images?.unoptimized).toBe(true);
    expect(cfg.env?.NEXT_PUBLIC_PHOTO_OPTIMIZE).toBe("off");
  });

  it("is on by default", () => {
    expect(nextConfig.images?.unoptimized).toBe(false);
  });
});
