"use client";

import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import { useBagTarget } from "@/lib/flyToBag";
import { CountUp } from "@/components/reactbits/CountUp";
import { fill } from "../format";

const t = copy.customer.home;
const b = copy.customer.brand;

export interface BagBarProps {
  /** Total number of items in the bag. */
  count: number;
  subtotalCents: number;
  /** True when checkout is unavailable (ordering closed, or the bag is empty). */
  disabled: boolean;
  onCheckout: () => void;
}

/**
 * STUB (task f0): fixed bottom bar with the FINAL props. It already registers as the fly-to-bag
 * landing target and rolls the amount with CountUp. The paper-bag task replaces the visuals
 * (kraft bag, swing on arrival) and must keep these props and the data-testids.
 */
export function BagBar({ count, subtotalCents, disabled, onCheckout }: BagBarProps) {
  const { ref } = useBagTarget();
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
      data-testid="bag-bar"
    >
      <div className="mx-auto flex max-w-xl items-center gap-3">
        <div ref={ref as React.RefObject<HTMLDivElement | null>} className="min-w-0 flex-1" aria-label={b.bagName}>
          <p className="text-sm text-muted" data-testid="bag-count">
            {fill(t.barCount, { count })}
          </p>
          <p className="text-lg font-semibold tabular-nums" data-testid="bag-subtotal">
            {fill(t.barSubtotal, { amount: "" })}
            <CountUp value={subtotalCents} format={formatCents} />
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onCheckout}
          className="min-h-12 rounded-full bg-accent px-6 text-base font-semibold text-accent-ink disabled:bg-disabled disabled:text-disabled-ink"
          data-testid="bag-checkout"
        >
          {t.goCheckout}
        </button>
      </div>
    </div>
  );
}
