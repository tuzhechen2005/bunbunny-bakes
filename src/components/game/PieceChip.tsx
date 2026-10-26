"use client";

import { useEffect, useRef, useState } from "react";
import { drawTierDisc, loadTierImage } from "./render";
import type { TierView } from "./types";

/** A small round picture of one tier (the next piece in the HUD). */
export function PieceChip({ tier, size = 40, className }: { tier: TierView; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    c.width = size * dpr;
    c.height = size * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const img = loadTierImage(tier.imageUrl, () => setLoaded((n) => n + 1));
    drawTierDisc(g, tier, size / 2, size / 2, size / 2 - 1, img);
  }, [tier, size, loaded]);
  return <canvas ref={ref} style={{ width: size, height: size }} className={className} aria-hidden="true" />;
}
