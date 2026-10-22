import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/PageHeader";
import { ProductForm } from "@/components/admin/products/ProductForm";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.products.newTitle} · ${copy.shopName}`,
};

export default function AdminNewProductPage() {
  return (
    <>
      <PageHeader title={copy.admin.products.newTitle} backHref="/admin/products" />
      <ProductForm />
    </>
  );
}
