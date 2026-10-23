import type { Metadata } from "next";
import { copy } from "@/copy";

// The list is built from secret order links: never indexed, never sent as a referrer (SECURITY.md §2).
export const metadata: Metadata = {
  title: `${copy.customer.myOrders.pageTitle} · ${copy.shopName}`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function OrdersLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex min-h-full flex-1 flex-col bg-c-wash text-c-ink">{children}</div>;
}
