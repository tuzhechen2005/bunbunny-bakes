import type { Metadata } from "next";
import { ProductList } from "@/components/admin/products/ProductList";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.products.title} · ${copy.shopName}`,
};

// Data is loaded client-side through the adminHandler-protected API.
export default function AdminProductsPage() {
  return <ProductList />;
}
