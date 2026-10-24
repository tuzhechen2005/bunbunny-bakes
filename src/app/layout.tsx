import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted subsets (regenerate with `npm run fonts`), no Google fonts at runtime.
// Display: Noto Sans SC pinned to 900 (`font-display`). Numerals: Fraunces, soft and bold (`font-num`).
const display = localFont({
  src: "../../public/fonts/noto-sans-sc-900.subset.woff2",
  weight: "900",
  style: "normal",
  display: "swap",
  variable: "--font-display-face",
  fallback: ["PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "sans-serif"],
});
const num = localFont({
  src: "../../public/fonts/fraunces-num.subset.woff2",
  weight: "700",
  style: "normal",
  display: "swap",
  variable: "--font-num-face",
  fallback: ["Georgia", "serif"],
});

// `cover` lets the page use the whole screen on notched phones (safe-area insets are handled in the
// CSS); the browser chrome is white, and the home page tints it with the bread colour while mounted.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export const metadata: Metadata = {
  title: "🐰的大面包",
  icons: { icon: "/brand/logo.webp" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`h-full antialiased ${display.variable} ${num.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
