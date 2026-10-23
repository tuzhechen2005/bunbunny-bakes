"use client";

import { useEffect, useRef } from "react";
import { FLY_DURATION_MS, getBagTargetRect, notifyArrive, subscribeFly, type FlyRequest } from "@/lib/flyToBag";
import { haptic, useMotionPrefs } from "@/lib/motion/react";

/**
 * STUB (task f0): minimal overlay that renders the flight described in src/lib/flyToBag.ts.
 * The paper-bag task replaces the visuals; keep the contract: fixed, pointer-events none,
 * ~0.6 s, calls notifyArrive() on landing, never blocks clicks. Mount once on pages with a bag.
 */
export function FlyLayer() {
  const host = useRef<HTMLDivElement>(null);
  const { reduced } = useMotionPrefs();

  useEffect(() => {
    return subscribeFly((req) => fly(req, host.current, reduced));
  }, [reduced]);

  return <div ref={host} aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 overflow-hidden" />;
}

function fly(req: FlyRequest, host: HTMLDivElement | null, reduced: boolean) {
  const to = getBagTargetRect();
  if (reduced || !host || !to || typeof host.animate !== "function") {
    haptic();
    notifyArrive();
    return;
  }
  const size = 40;
  const el = document.createElement("div");
  el.style.cssText = `position:absolute;left:0;top:0;width:${size}px;height:${size}px;border-radius:8px;background:var(--soft) center/cover no-repeat;will-change:transform,opacity`;
  if (req.imageUrl) el.style.backgroundImage = `url("${req.imageUrl.replace(/"/g, "%22")}")`;
  host.appendChild(el);

  const x0 = req.from.left + req.from.width / 2 - size / 2;
  const y0 = req.from.top + req.from.height / 2 - size / 2;
  const x1 = to.left + to.width / 2 - size / 2;
  const y1 = to.top + to.height / 2 - size / 2;
  const lift = Math.max(60, Math.abs(y1 - y0) * 0.25);
  const anim = el.animate(
    [
      { transform: `translate(${x0}px, ${y0}px) scale(1)`, opacity: 1 },
      { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - lift}px) scale(0.8)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${x1}px, ${y1}px) scale(0.3)`, opacity: 0.6 },
    ],
    { duration: FLY_DURATION_MS, easing: "cubic-bezier(0.4, 0, 0.6, 1)" },
  );
  const done = () => {
    el.remove();
    haptic();
    notifyArrive();
  };
  anim.onfinish = done;
  anim.oncancel = () => el.remove();
}
