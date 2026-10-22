"use client";

import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/admin/PageHeader";
import { BunnyPlaceholder } from "@/components/customer/BunnyPlaceholder";
import { copy } from "@/copy";
import { adminApi } from "@/lib/adminApi";
import { modeLabel, priceLine, statusLabel, type ProductDto } from "./describe";
import { useProducts } from "./useProducts";

const t = copy.admin.products;

const arrowClass =
  "flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-soft text-lg disabled:opacity-40";

const chipClass: Record<ProductDto["status"], string> = {
  ACTIVE: "bg-soft text-foreground",
  PAUSED: "bg-disabled text-disabled-ink",
  ARCHIVED: "border border-line text-muted",
};

export function ProductList() {
  const state = useProducts();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(products: ProductDto[], index: number, delta: -1 | 1) {
    const target = index + delta;
    if (busy || target < 0 || target >= products.length) return;
    const ids = products.map((p) => p.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true);
    setError(null);
    const result = await adminApi<{ products: ProductDto[] }>("/api/admin/products/reorder", {
      method: "POST",
      body: { ids },
    });
    if (result.ok) state.setProducts(result.data.products);
    else setError(result.message);
    setBusy(false);
  }

  return (
    <>
      <PageHeader
        title={t.title}
        actions={
          <Link
            href="/admin/products/new"
            className="flex min-h-11 items-center rounded-lg bg-accent px-4 text-base font-medium text-accent-ink"
          >
            {t.addProduct}
          </Link>
        }
      />
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}
      {state.status === "loading" && <p className="text-muted">{t.loading}</p>}
      {state.status === "error" && (
        <div role="alert" className="text-danger">
          <p>{state.message}</p>
          <button type="button" onClick={state.reload} className="mt-2 min-h-11 underline">
            {t.retry}
          </button>
        </div>
      )}
      {state.status === "ready" && state.products.length === 0 && <p className="text-muted">{t.empty}</p>}
      {state.status === "ready" && state.products.length > 0 && (
        <ul className="flex flex-col gap-3">
          {state.products.map((p, i, all) => (
            <li
              key={p.id}
              className="flex items-stretch gap-2 rounded-xl border border-line bg-card p-3"
            >
              <Link
                href={`/admin/products/${p.id}`}
                className="flex min-w-0 flex-1 items-center gap-3"
                aria-label={p.name}
              >
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                ) : (
                  <BunnyPlaceholder className="h-16 w-16 shrink-0 rounded-lg" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-base font-semibold">{p.name}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${chipClass[p.status]}`}>
                      {statusLabel(p.status)}
                    </span>
                  </span>
                  <span className="block text-sm text-muted">{priceLine(p)}</span>
                  <span className="block text-sm text-muted">{modeLabel(p)}</span>
                </span>
              </Link>
              <div className="flex shrink-0 flex-col justify-between gap-1">
                <button
                  type="button"
                  className={arrowClass}
                  aria-label={`${t.moveUp}：${p.name}`}
                  disabled={busy || i === 0}
                  onClick={() => move(all, i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={arrowClass}
                  aria-label={`${t.moveDown}：${p.name}`}
                  disabled={busy || i === all.length - 1}
                  onClick={() => move(all, i, 1)}
                >
                  ↓
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
