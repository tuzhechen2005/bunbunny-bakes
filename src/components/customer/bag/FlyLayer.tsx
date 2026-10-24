"use client";

import { useEffect, useRef } from "react";
import { getBagTargetRect, notifyArrive, subscribeFly, type FlyRequest } from "@/lib/flyToBag";
import { haptic, useMotionPrefs } from "@/lib/motion/react";
import { photoCssUrl, THUMB_WIDTH } from "@/lib/photo";
import { flightBegin, flightLand, type BagTarget } from "./bagFlights";
import "./bag.css";

/** Flight time of one disc (prototype: 620 ms). */
const FLIGHT_MS = 620;
/** Pause between the discs of one add. */
const STAGGER_MS = 70;
/** At most this many discs per add; the last one carries the rest. */
const MAX_DISCS = 6;
const DISC = 64;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The bag window a flight should land in: the sheet's big bag when it is open, else the bar's. */
function findWindow(): { rect: DOMRect; target: BagTarget | null } | null {
  if (typeof document === "undefined") return null;
  const sheet = document.querySelector('[data-bag-target="sheet"] [data-pb-window]');
  if (sheet) return { rect: sheet.getBoundingClientRect(), target: "sheet" };
  const bar = document.querySelector('[data-bag-target="bar"] [data-pb-window]');
  if (bar) return { rect: bar.getBoundingClientRect(), target: "bar" };
  const rect = getBagTargetRect();
  return rect ? { rect, target: null } : null;
}

/**
 * Circular photo flights into the bag (FRONTEND.md 4.3), driven by `flyToBag()` requests.
 * Each add flies as up to six discs 70 ms apart (the last one carries the remainder); a disc
 * rises, turns a little, then drops and shrinks into the bag window along the prototype's arc
 * (620 ms). On landing the bags get their bodies (see bagFlights.ts). Fixed, `pointer-events:
 * none`, never blocks a click. Reduced motion or no bag on the page: no flight, the landing
 * happens at once. Mount once on a page with a bag.
 */
export function FlyLayer() {
  const host = useRef<HTMLDivElement>(null);
  const { reduced } = useMotionPrefs();
  const reducedRef = useRef(reduced);

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  useEffect(() => {
    // Everything still in flight, so unmounting can land it instead of leaving the bag short.
    const open = new Set<() => void>();

    function start(req: FlyRequest) {
      const count = Math.max(1, Math.floor(req.count ?? 1));
      flightBegin({ productId: req.productId, count });
      if (reducedRef.current) {
        // No flight: the bread is in the bag at once.
        flightLand({ productId: req.productId, count, xFrac: null, target: null, first: true });
        haptic(12);
        notifyArrive();
        return;
      }
      const discs = Math.min(count, MAX_DISCS);

      for (let q = 0; q < discs; q++) {
        const carries = q === discs - 1 ? count - discs + 1 : 1;
        const first = q === 0;
        let finished = false;
        let el: HTMLDivElement | null = null;
        let timers: ReturnType<typeof setTimeout>[] = [];

        const land = (xFrac: number | null, target: BagTarget | null) => {
          if (finished) return;
          finished = true;
          open.delete(abort);
          timers.forEach(clearTimeout);
          timers = [];
          el?.remove();
          flightLand({ productId: req.productId, count: carries, xFrac, target, first });
          if (first) haptic(12);
          notifyArrive();
        };
        const abort = () => land(null, null);
        open.add(abort);

        timers.push(
          setTimeout(() => {
            if (finished) return;
            const win = findWindow();
            const root = host.current;
            if (!win || !root || win.rect.width === 0) {
              land(null, null);
              return;
            }
            const tw = win.rect;
            const fr = req.from;
            const sx = fr.left + fr.width / 2 - DISC / 2;
            const sy = fr.top + fr.height / 2 - DISC / 2;
            const tx = tw.left + tw.width / 2 + (Math.random() - 0.5) * tw.width * 0.4;
            const ty = tw.top + 4;
            const dx = tx - DISC / 2 - sx;
            const dy = ty - DISC / 2 - sy;
            const end = Math.max(0.26, (tw.width * 0.34) / DISC);

            const outer = document.createElement("div");
            outer.className = "bag-fly";
            outer.style.transform = `translate(${sx}px,${sy}px)`;
            const disc = document.createElement("i");
            if (req.imageUrl) disc.style.backgroundImage = photoCssUrl(req.imageUrl, THUMB_WIDTH);
            else disc.className = "pb-ph";
            outer.appendChild(disc);
            root.appendChild(outer);
            el = outer;

            if (typeof outer.animate !== "function") {
              land(null, win.target);
              return;
            }
            // Horizontal progress on the outer element, the arc on the disc.
            outer.animate(
              [{ transform: `translate(${sx}px,${sy}px)` }, { transform: `translate(${sx + dx}px,${sy}px)` }],
              { duration: FLIGHT_MS, easing: "cubic-bezier(.3,.1,.4,1)", fill: "forwards" },
            );
            const arc = disc.animate(
              [
                { transform: "translateY(0) scale(.4) rotate(0)", easing: "cubic-bezier(.2,.9,.4,1)" },
                { offset: 0.18, transform: "translateY(-30px) scale(1.12) rotate(-8deg)", easing: "cubic-bezier(.3,0,.4,1)" },
                { offset: 0.42, transform: "translateY(-70px) scale(1) rotate(-14deg)", easing: "cubic-bezier(.55,0,.85,.3)" },
                { transform: `translateY(${dy}px) scale(${end}) rotate(40deg)` },
              ],
              { duration: FLIGHT_MS, fill: "forwards" },
            );
            const xFrac = clamp((tx - tw.left) / tw.width, 0, 1);
            arc.onfinish = () => land(xFrac, win.target);
            arc.oncancel = () => land(xFrac, win.target);
            // A hidden tab can hold animations back; never leave the bread in the air.
            timers.push(setTimeout(() => land(xFrac, win.target), FLIGHT_MS + 1500));
          }, q * STAGGER_MS),
        );
      }
    }

    const unsubscribe = subscribeFly(start);
    return () => {
      unsubscribe();
      [...open].forEach((abort) => abort());
    };
  }, []);

  return <div ref={host} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[90] overflow-hidden" />;
}
