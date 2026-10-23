"use client";

import { copy } from "@/copy";
import { fill } from "./format";
import { MinusIcon, PlusIcon } from "./rack/icons";

const t = copy.customer.home;

const btn =
  "grid h-[42px] w-11 shrink-0 place-items-center transition-transform duration-150 active:scale-95 " +
  "disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100";

/**
 * − qty + pill with 44 px touch targets (home grid tiles, checkout lines).
 * `onPhoto` adds a white pill with a shadow so it reads on top of a product photo.
 */
export function QtyStepper({
  qty,
  canIncrease,
  onDecrease,
  onIncrease,
  onPhoto = false,
}: {
  qty: number;
  canIncrease: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  onPhoto?: boolean;
}) {
  return (
    <div
      className={`flex h-[42px] items-center rounded-full text-c-ink ${
        onPhoto ? "bg-c-paper shadow-[0_6px_16px_-6px_rgba(0,0,0,0.35)]" : "bg-c-wash"
      }`}
    >
      <button type="button" className={btn} aria-label={t.decrease} disabled={qty <= 0} onClick={onDecrease}>
        <MinusIcon className="h-4 w-4" />
      </button>
      <span
        className="font-num min-w-5 text-center text-lg font-bold"
        aria-label={fill(t.qtyLabel, { qty })}
        data-testid="qty"
      >
        {qty}
      </span>
      <button type="button" className={btn} aria-label={t.increase} disabled={!canIncrease} onClick={onIncrease}>
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
