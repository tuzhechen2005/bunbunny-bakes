import type { Metadata } from "next";
import { OrderFormLoader } from "@/components/admin/orders/OrderFormLoader";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.orderForm.editTitleShort} · ${copy.shopName}`,
};

export default async function EditOrderPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <OrderFormLoader orderId={id} />;
}
