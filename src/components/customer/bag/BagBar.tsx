"use client";

import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import type { MenuProduct } from "@/lib/api";
import type { CartItem } from "@/lib/cart";
import { useBagTarget } from "@/lib/flyToBag";
import { fill } from "../format";

const t = copy.customer.home;
const b = copy.customer.brand;

export interface BagBarProps {
  /** Menu products (for the bag sheet lines and the pile thumbnails). */
  products: readonly MenuProduct[];
  /** Max quantity per item (Menu.maxQtyPerItem). */
  maxQty: number;
  cart: readonly CartItem[];
  /** Total number of items in the bag. */
  count: number;
  subtotalCents: number;
  /** False when ordering is closed: the bag still opens, checkout is disabled. */
  orderingEnabled: boolean;
  onIncrease: (productId: string) => void;
  onDecrease: (productId: string) => void;
  /** Go to /checkout (the bag sheet's 「去结算」). */
  onCheckout: () => void;
  /** True while the product detail is open: only the little bag stays visible (FRONTEND.md 4.2). */
  compact?: boolean;
}

/**
 * STUB (task g0): fixed bottom bar with the FINAL props. It registers as the fly-to-bag landing
 * target. The paper-bag task (g2) replaces the visuals (mini paper bag with the pile, pill button,
 * bag sheet) and must keep these props and the data-testids.
 */
export function BagBar({ count, subtotalCents, orderingEnabled, onCheckout, compact }: BagBarProps) {
  const { ref } = useBagTarget();
  const disabled = !orderingEnabled || count === 0;
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-c-line bg-c-paper px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${compact ? "opacity-60" : ""}`}
      data-testid="bag-bar"
    >
      <div className="mx-auto flex max-w-[430px] items-center gap-3">
        <div ref={ref as React.RefObject<HTMLDivElement | null>} className="min-w-0 flex-1" aria-label={b.bagName}>
          <p className="text-sm text-c-grey" data-testid="bag-count">
            {fill(t.barCount, { count })}
          </p>
          <p className="font-num text-lg" data-testid="bag-subtotal">
            {formatCents(subtotalCents)}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onCheckout}
          className="min-h-12 rounded-full bg-c-ink px-6 text-base font-semibold text-c-paper disabled:opacity-40"
          data-testid="bag-checkout"
        >
          {orderingEnabled ? t.goCheckout : t.checkoutClosed}
        </button>
      </div>
    </div>
  );
}
