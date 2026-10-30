"use client";

import { useCallback, useEffect, useState } from "react";
import type { GameHub } from "@/lib/gameCatalog";
import { call } from "./gameApi";

/** Refresh on return to the page; failed requests never advertise an unconfirmed prize. */
export function useGameHub(enabled = true) {
  const [data, setData] = useState<GameHub | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let request = 0;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      const id = ++request;
      const result = await call<GameHub>("/api/game/hub");
      if (!alive || id !== request) return;
      setData(result.ok ? result.data : null);
      setError(!result.ok);
    };
    void load();
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
      document.removeEventListener("visibilitychange", load);
    };
  }, [enabled, attempt]);
  return { data, error, reload };
}
