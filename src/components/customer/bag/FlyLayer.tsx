"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BunnyMark } from "@/components/brand/BunnyMark";
import { FLY_DURATION_MS, getBagTargetRect, notifyArrive, subscribeFly, type FlyRequest } from "@/lib/flyToBag";
import { haptic, useMotionPrefs } from "@/lib/motion/react";

const SIZE = 44;
const SAMPLES = 8;

interface Flight {
  id: number;
  req: FlyRequest;
  to: DOMRect;
}

/**
 * Renders the flights of src/lib/flyToBag.ts: a thumbnail follows an arc into the bag (about 0.6 s,
 * transforms and opacity only). Fixed, `pointer-events: none` overlay, so clicks are never blocked;
 * flights overlap freely. On landing it calls notifyArrive() and haptic(15). Reduced motion (or no
 * bag mounted): no flight, arrival fires immediately. Mount once on a page that has a BagBar.
 */
export function FlyLayer() {
  const [flights, setFlights] = useState<Flight[]>([]);
  const nextId = useRef(0);
  const { reduced } = useMotionPrefs();

  useEffect(() => {
    return subscribeFly((req) => {
      const to = getBagTargetRect();
      if (reduced || !to || typeof Element.prototype.animate !== "function") {
        haptic();
        notifyArrive();
        return;
      }
      setFlights((f) => [...f, { id: nextId.current++, req, to }]);
    });
  }, [reduced]);

  const land = useCallback((id: number) => {
    setFlights((f) => f.filter((x) => x.id !== id));
    haptic();
    notifyArrive();
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 overflow-hidden" data-testid="fly-layer">
      {flights.map((f) => (
        <FlyingThumb key={f.id} flight={f} onLand={land} />
      ))}
    </div>
  );
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function FlyingThumb({ flight, onLand }: { flight: Flight; onLand: (id: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const { req, to, id } = flight;

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const x0 = req.from.left + req.from.width / 2 - SIZE / 2;
    const y0 = req.from.top + req.from.height / 2 - SIZE / 2;
    const x1 = to.left + to.width / 2 - SIZE / 2;
    const y1 = to.top + to.height / 2 - SIZE / 2;
    const lift = Math.max(60, Math.abs(y1 - y0) * 0.25);
    const frames: Keyframe[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const p = i / SAMPLES;
      const e = ease(p);
      const x = x0 + (x1 - x0) * e;
      const y = y0 + (y1 - y0) * e - 4 * lift * p * (1 - p);
      frames.push({
        transform: `translate(${x}px, ${y}px) scale(${1 - 0.7 * e})`,
        opacity: p < 0.85 ? 1 : 1 - (p - 0.85) * 2.6,
        offset: p,
      });
    }
    const anim = node.animate(frames, { duration: FLY_DURATION_MS, easing: "linear", fill: "forwards" });
    let landed = false;
    const finish = () => {
      if (landed) return;
      landed = true;
      onLand(id);
    };
    anim.onfinish = finish;
    return () => {
      anim.onfinish = null;
      anim.cancel();
    };
  }, [req, to, id, onLand]);

  return (
    <div
      ref={el}
      data-testid="fly-thumb"
      className="absolute top-0 left-0 flex items-center justify-center overflow-hidden rounded-lg border border-line bg-soft text-accent-strong"
      style={{
        width: SIZE,
        height: SIZE,
        willChange: "transform, opacity",
        backgroundImage: req.imageUrl ? `url("${req.imageUrl.replace(/"/g, "%22")}")` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {req.imageUrl ? null : <BunnyMark size={28} />}
    </div>
  );
}
