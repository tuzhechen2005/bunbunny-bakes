import type { Metadata } from "next";
import { PoolsPage } from "@/components/admin/pools/PoolsPage";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.pools.title} · ${copy.shopName}`,
};

// Client-side: the page reads /api/admin/group-pools and /api/admin/stock-lots.
export default function AdminPoolsPage() {
  return <PoolsPage />;
}
