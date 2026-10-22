import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductEditor } from "@/components/admin/products/ProductEditor";
import { copy } from "@/copy";

export const metadata: Metadata = {
  title: `${copy.admin.products.editTitle} · ${copy.shopName}`,
};

async function EditProduct({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  return <ProductEditor id={id} />;
}

export default function AdminEditProductPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  return (
    <Suspense fallback={null}>
      <EditProduct params={params} />
    </Suspense>
  );
}
