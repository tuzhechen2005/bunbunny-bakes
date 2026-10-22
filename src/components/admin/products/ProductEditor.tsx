"use client";

import { copy } from "@/copy";
import { PageHeader } from "@/components/admin/PageHeader";
import { ProductForm } from "./ProductForm";
import { useProducts } from "./useProducts";

const t = copy.admin.products;

/** Edit page body: loads the list through the admin API and edits the matching product. */
export function ProductEditor({ id }: Readonly<{ id: string }>) {
  const state = useProducts();
  const product = state.status === "ready" ? state.products.find((p) => p.id === id) : undefined;

  return (
    <>
      <PageHeader title={t.editTitle} backHref="/admin/products" />
      {state.status === "loading" && <p className="text-muted">{t.loading}</p>}
      {state.status === "error" && (
        <p role="alert" className="text-danger">
          {state.message}
        </p>
      )}
      {state.status === "ready" && !product && (
        <p role="alert" className="text-danger">
          {t.notFound}
        </p>
      )}
      {product && <ProductForm key={product.id} product={product} />}
    </>
  );
}
