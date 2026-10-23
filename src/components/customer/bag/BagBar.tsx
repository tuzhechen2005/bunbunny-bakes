"use client";

import { useEffect, useRef } from "react";
import { BunnyMark } from "@/components/brand/BunnyMark";
import { CountUp } from "@/components/reactbits/CountUp";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import { useBagTarget } from "@/lib/flyToBag";
import { Pendulum } from "@/lib/motion/pendulum";
import { createLoop } from "@/lib/motion/loop";
import { useMotionPrefs } from "@/lib/motion/react";
import { fill } from "../format";
import { PaperBagIcon } from "./PaperBagIcon";

const t = copy.customer.home;
const b = copy.customer.brand;

/** Angular velocity (rad/s) given to the bag when a flight lands: peaks near 12 degrees, still in about a second. */
const LANDING_KICK = 2.4;

export interface BagBarProps {
  /** Total number of items in the bag. */
  count: number;
  subtotalCents: number;
  /** True when checkout is unavailable (ordering closed, or the bag is empty). */
  disabled: boolean;
  onCheckout: () => void;
  /** Ordering closed: the button reads 「暂未开放预订」 instead of 「去结算」. */
  closed?: boolean;
}

/**
 * Sticky bottom 「你的纸袋」: kraft bag icon, count, subtotal (CountUp), checkout.
 * It is the fly-to-bag landing target; on arrival the bag swings once around its bottom edge
 * (F0 pendulum) and the count bumps. Reduced motion: neither. Degraded: bump only, no pendulum.
 */
export function BagBar({ count, subtotalCents, disabled, onCheckout, closed = false }: BagBarProps) {
  const { ref, onArrive } = useBagTarget();
  const { reduced, degraded } = useMotionPrefs();
  const swingRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLParagraphElement>(null);
  const prefs = useRef({ reduced, degraded });
  useEffect(() => {
    prefs.current = { reduced, degraded };
  }, [reduced, degraded]);

  useEffect(() => {
    const pendulum = new Pendulum();
    const loop = createLoop((dt) => {
      pendulum.step(dt, 0);
      const el = swingRef.current;
      if (!el) return false;
      if (pendulum.isAtRest()) {
        pendulum.settle();
        el.style.transform = "";
        return false;
      }
      el.style.transform = `rotate(${pendulum.angle}rad)`;
      return true;
    });
    const off = onArrive(() => {
      const { reduced: r, degraded: d } = prefs.current;
      if (r) return;
      const num = countRef.current;
      if (num && typeof num.animate === "function") {
        num.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)", offset: 0.4 }, { transform: "scale(1)" }], {
          duration: 280,
          easing: "ease-out",
        });
      }
      if (d) return;
      pendulum.omega = LANDING_KICK;
      loop.start();
    });
    return () => {
      off();
      loop.stop();
    };
    // onArrive only touches a module-level listener set, so it is safe to subscribe once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
      data-testid="bag-bar"
    >
      <div className="mx-auto flex max-w-xl items-center gap-3">
        <div ref={ref as React.RefObject<HTMLDivElement | null>} className="shrink-0" data-testid="bag-target">
          <div ref={swingRef} style={{ transformOrigin: "50% 100%", willChange: "transform" }}>
            <PaperBagIcon size={44} />
          </div>
        </div>
        <div className="min-w-0 flex-1" aria-label={b.bagName}>
          <p className="font-serif text-base font-semibold text-foreground">{b.bagName}</p>
          <p ref={countRef} className="origin-left text-sm text-muted" data-testid="bag-count">
            {fill(t.barCount, { count })}
          </p>
          <p className="text-lg font-semibold tabular-nums" data-testid="bag-subtotal">
            <span>{t.barSubtotalLabel}</span> <CountUp value={subtotalCents} format={formatCents} />
          </p>
          {count === 0 ? (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted" data-testid="bag-empty">
              <BunnyMark size={16} />
              <span>{b.emptyBag}</span>
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onCheckout}
          className="min-h-12 shrink-0 rounded-full bg-accent px-6 text-base font-semibold text-accent-ink active:bg-accent-strong disabled:bg-disabled disabled:text-disabled-ink"
          data-testid="bag-checkout"
        >
          {closed ? t.checkoutClosed : t.goCheckout}
        </button>
      </div>
    </div>
  );
}
