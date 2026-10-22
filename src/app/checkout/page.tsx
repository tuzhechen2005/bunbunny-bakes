import type { Metadata } from "next";
import { CheckoutPage } from "@/components/customer/CheckoutPage";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.customer.checkout.pageTitle} · ${copy.shopName}`,
};

// Static shell; menu, cart and availability load on the client.
export default function Checkout() {
  return <CheckoutPage />;
}
