import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // SECURITY.md §2: order links and the admin area must not leak via Referer or be indexed.
  async headers() {
    const noReferrer = { key: "Referrer-Policy", value: "no-referrer" };
    const noIndex = { key: "X-Robots-Tag", value: "noindex" };
    return [
      { source: "/o/:path*", headers: [noReferrer, noIndex] },
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
