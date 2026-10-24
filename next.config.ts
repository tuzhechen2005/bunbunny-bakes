import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // D91: product photos (1250+ px originals in Netlify Blobs, served by /api/images) are resized
  // by the image optimizer to the displayed size. Only that path may be optimized; avif then webp
  // by the browser's Accept header. The sizes below are the widths the srcset can pick from:
  // 128 for thumbnails (bag rows, flying discs), the rest cover the rope, grid and detail photo
  // at 1x-3x on phones and desktop (see src/lib/photo.ts for the `sizes` of each place).
  images: {
    formats: ["image/avif", "image/webp"],
    localPatterns: [{ pathname: "/api/images/**" }],
    imageSizes: [128, 192, 256, 384],
    deviceSizes: [480, 640, 750, 900, 1080, 1920],
    qualities: [75],
  },
  // SECURITY.md §2: order links and the admin area must not leak via Referer or be indexed.
  async headers() {
    const noReferrer = { key: "Referrer-Policy", value: "no-referrer" };
    const noIndex = { key: "X-Robots-Tag", value: "noindex" };
    return [
      { source: "/o/:path*", headers: [noReferrer, noIndex] },
      { source: "/orders", headers: [noReferrer, noIndex] },
      { source: "/admin/:path*", headers: [noReferrer, noIndex] },
      { source: "/api/o/:path*", headers: [noReferrer] },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
