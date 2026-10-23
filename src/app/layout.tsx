import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Subsetted Noto Serif SC SemiBold (regenerate with `npm run fonts`). Self-hosted, no Google fonts.
// Tailwind's `font-serif` maps to this via --font-serif-face (globals.css), Songti SC as fallback.
const serif = localFont({
  src: "../../public/fonts/noto-serif-sc-600.subset.woff2",
  weight: "600",
  style: "normal",
  display: "swap",
  variable: "--font-serif-face",
  fallback: ["Songti SC", "STSong", "serif"],
});

export const metadata: Metadata = {
  title: "🐰的大面包",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`h-full antialiased ${serif.variable}`}>
      <body className="paper-grain min-h-full flex flex-col">{children}</body>
    </html>
  );
}
