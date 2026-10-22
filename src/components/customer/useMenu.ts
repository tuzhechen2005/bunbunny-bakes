"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMenu, type Menu } from "@/lib/api";
import { cart } from "@/lib/cart";

export type MenuState =
  | { status: "loading"; menu: null }
  | { status: "error"; menu: null }
  | { status: "ready"; menu: Menu };

/** Loads /api/menu on mount; silently drops cart lines whose product left the menu. */
export function useMenu(): MenuState & { reload: () => void } {
  const [state, setState] = useState<MenuState>({ status: "loading", menu: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    fetchMenu().then((result) => {
      if (!active) return;
      if (result.ok && Array.isArray(result.data.products)) {
        cart.retainProducts(result.data.products.map((p) => p.id));
        setState({ status: "ready", menu: result.data });
      } else {
        setState({ status: "error", menu: null });
      }
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading", menu: null });
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, reload };
}
