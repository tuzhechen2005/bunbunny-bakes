"use client";

import { MinusIcon, PlusIcon } from "@/components/customer/bag/icons";
import { focusRing } from "./focus";

export type StepperSize = "sm" | "md" | "lg";
export type StepperTone = "wash" | "paper" | "fink";

const HEIGHT: Record<StepperSize, string> = { sm: "h-[42px]", md: "h-11", lg: "h-[58px]" };
const BUTTON_W: Record<StepperSize, string> = { sm: "min-w-11", md: "min-w-11", lg: "min-w-[58px]" };
const ICON: Record<StepperSize, string> = { sm: "size-4", md: "size-4", lg: "size-5" };
const NUMBER: Record<StepperSize, string> = { sm: "text-lg", md: "text-[15px]", lg: "text-2xl" };
const TONE: Record<StepperTone, string> = {
  wash: "bg-c-wash text-c-ink",
  paper: "bg-c-paper text-c-ink shadow-[0_6px_16px_-6px_color-mix(in_srgb,var(--c-ink)_35%,transparent)]",
  fink: "bg-fink text-field",
};

export interface StepperProps {
  qty: number;
  size?: StepperSize;
  tone?: StepperTone;
  canIncrease?: boolean;
  /** The decrease button is disabled at 0 unless the owner removes the line at 1 (`allowZero`). */
  canDecrease?: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
  /** Accessible names; include the product so a screen reader hears what changes. */
  decreaseLabel: string;
  increaseLabel: string;
  qtyLabel: string;
  decreaseTestId?: string;
  increaseTestId?: string;
  qtyTestId?: string;
  className?: string;
}

/**
 * − qty + pill shared by the bag sheet and the checkout lines (and the home page later).
 * sm 42 px (grid tile), md 44 px (lines), lg 58 px (detail); the buttons are at least 44 px wide,
 * and the 42 px one extends its hit area to 44 px.
 */
export function Stepper({
  qty,
  size = "md",
  tone = "wash",
  canIncrease = true,
  canDecrease = true,
  onDecrease,
  onIncrease,
  decreaseLabel,
  increaseLabel,
  qtyLabel,
  decreaseTestId,
  increaseTestId,
  qtyTestId,
  className = "",
}: StepperProps) {
  const button = `relative grid h-full ${BUTTON_W[size]} shrink-0 place-items-center rounded-full after:absolute after:inset-x-0 after:-inset-y-px after:content-[''] transition-transform duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 disabled:active:scale-100 motion-reduce:active:scale-100 ${focusRing}`;
  return (
    <div className={`flex ${HEIGHT[size]} shrink-0 items-center rounded-full ${TONE[tone]} ${className}`}>
      <button
        type="button"
        className={button}
        aria-label={decreaseLabel}
        disabled={!canDecrease}
        onClick={onDecrease}
        data-testid={decreaseTestId}
      >
        <MinusIcon className={ICON[size]} />
      </button>
      <b
        className={`font-num min-w-5 text-center font-bold ${NUMBER[size]}`}
        aria-label={qtyLabel}
        data-testid={qtyTestId}
      >
        {qty}
      </b>
      <button
        type="button"
        className={button}
        aria-label={increaseLabel}
        disabled={!canIncrease}
        onClick={onIncrease}
        data-testid={increaseTestId}
      >
        <PlusIcon className={ICON[size]} />
      </button>
    </div>
  );
}
