"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMenu, type Menu } from "@/lib/api";
import { cart } from "@/lib/cart";

export type MenuState =
  | { status: "loading"; menu: null }
  | { status: "error"; menu: null }
  | { status: "ready"; menu: Menu };

/**
 * Loads /api/menu on mount; silently drops cart lines whose product left the menu.
 * `initial` is the menu the server rendered the page with (D91): it is shown at once, and the
 * fetch still runs, so the fresh answer wins (ordering closed, a paused or removed product). A
 * failed fetch keeps what is on screen; only the manual reload shows the loading state again.
 */
export function useMenu(initial: Menu | null = null): MenuState & { reload: () => void } {
  const [state, setState] = useState<MenuState>(
    initial ? { status: "ready", menu: initial } : { status: "loading", menu: null },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    fetchMenu().then((result) => {
      if (!active) return;
      if (result.ok && Array.isArray(result.data.products)) {
        cart.retainProducts(result.data.products.map((p) => p.id));
        setState({ status: "ready", menu: result.data });
      } else {
        setState((s) => (s.status === "ready" ? s : { status: "error", menu: null }));
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
