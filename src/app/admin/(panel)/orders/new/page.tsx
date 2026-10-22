import type { Metadata } from "next";
import { OrderFormLoader } from "@/components/admin/orders/OrderFormLoader";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.orderForm.newTitle} · ${copy.shopName}`,
};

// No data is read here: the client loads it through the protected admin API.
export default function NewOrderPage() {
  return <OrderFormLoader />;
}
