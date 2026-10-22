"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi } from "@/lib/adminApi";
import { copy } from "@/copy";
import type { ProductDto } from "./describe";

export type ProductsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; products: ProductDto[] };

/** Loads GET /api/admin/products on mount (client-side, so the page itself reads no data). */
export function useProducts(): ProductsState & {
  reload: () => void;
  setProducts: (products: ProductDto[]) => void;
} {
  const [state, setState] = useState<ProductsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    adminApi<{ products: ProductDto[] }>("/api/admin/products").then((result) => {
      if (!active) return;
      if (result.ok && Array.isArray(result.data.products)) {
        setState({ status: "ready", products: result.data.products });
      } else {
        setState({
          status: "error",
          message: result.ok ? copy.admin.products.loadFailed : result.message,
        });
      }
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  const setProducts = useCallback((products: ProductDto[]) => setState({ status: "ready", products }), []);

  return { ...state, reload, setProducts };
}
