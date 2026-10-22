import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersListPage } from "@/components/admin/orders/OrdersListPage";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.orders.listTitle} · ${copy.shopName}`,
};

// Data is loaded client-side through the adminHandler-protected API.
export default function AdminOrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersListPage />
    </Suspense>
  );
}
