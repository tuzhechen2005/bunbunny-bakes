import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderDetailPage } from "@/components/admin/orders/OrderDetailPage";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.orders.detailTitle} · ${copy.shopName}`,
};

// Data is loaded client-side through the adminHandler-protected API.
async function Detail({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <OrderDetailPage id={id} />;
}

export default function AdminOrderDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  return (
    <Suspense fallback={null}>
      <Detail params={params} />
    </Suspense>
  );
}
