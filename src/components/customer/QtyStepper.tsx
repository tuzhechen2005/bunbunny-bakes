"use client";

import { copy } from "@/copy";
import { fill } from "./format";

const t = copy.customer.home;

const btn =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-xl leading-none transition-colors " +
  "border-line bg-card text-foreground active:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "disabled:border-line disabled:bg-transparent disabled:text-disabled-ink";

/** − qty + with 44px touch targets. */
export function QtyStepper({
  qty,
  canIncrease,
  onDecrease,
  onIncrease,
}: {
  qty: number;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <div className="flex items-center">
      <button type="button" className={btn} aria-label={t.decrease} disabled={qty <= 0} onClick={onDecrease}>
        −
      </button>
      <span
        className="min-w-9 text-center text-base font-semibold tabular-nums"
        aria-label={fill(t.qtyLabel, { qty })}
        data-testid="qty"
      >
        {qty}
      </span>
      <button type="button" className={btn} aria-label={t.increase} disabled={!canIncrease} onClick={onIncrease}>
        +
      </button>
    </div>
  );
}
