import type { Metadata } from "next";

// Order links carry a secret token: never indexed, never sent as a referrer (SECURITY.md §2).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function OrderLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex min-h-full flex-1 flex-col bg-c-wash text-c-ink">{children}</div>;
}
