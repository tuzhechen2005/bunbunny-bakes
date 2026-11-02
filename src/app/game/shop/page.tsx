import type { Metadata } from "next";
import { ShopPage } from "@/components/game/ShopPage";
import { copy } from "@/copy";

export const metadata: Metadata = { title: `${copy.customer.shop.pageTitle} · ${copy.shopName}` };

export default function Shop() {
  return <ShopPage />;
}
