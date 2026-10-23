"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { Logo } from "@/components/brand/Logo";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import type { MenuProduct } from "@/lib/api";
import type { CartItem } from "@/lib/cart";
import { Spring } from "@/lib/motion";
import { useMotionPrefs } from "@/lib/motion/react";
import { fill, safeLineTotal } from "../format";
import { arrowZoom, done, play } from "./anim";
import type { Landing } from "./bagFlights";
import { ArrowIcon, CloseIcon, MinusIcon, PlusIcon } from "./icons";
import { PaperBag, type PaperBagHandle, type PaperBagItem } from "./PaperBag";
import { RollText } from "./RollText";
import { useSwing } from "./useSwing";
import "./bag.css";

const t = copy.customer.home;
const b = copy.customer.brand;

export interface BagSheetHandle {
  /** A flight landed in this bag: drop the bodies in, swing and squash on the first one. */
  land(l: Landing): void;
}

export interface BagSheetProps {
  products: readonly MenuProduct[];
  maxQty: number;
  cart: readonly CartItem[];
  /** What the big bag shows (the cart minus breads still in the air). */
  items: readonly PaperBagItem[];
  count: number;
  subtotalCents: number;
  orderingEnabled: boolean;
  onIncrease: (productId: string) => void;
  onDecrease: (productId: string) => void;
  onCheckout: () => void;
  /** Called after the closing animation; the owner unmounts the sheet. */
  onClose: () => void;
}

/** Sheet slide-up as a spring (1.8 Hz, 0.7) sampled at 60 Hz into keyframes. */
function springKeyframes(): Keyframe[] {
  const s = new Spring(100, { frequencyHz: 1.8, dampingRatio: 0.7 });
  s.target = 0;
  const kf: Keyframe[] = [];
  for (let i = 0; i < 120; i++) {
    kf.push({ transform: `translateY(${s.x.toFixed(2)}%)` });
    s.step(1 / 60);
    if (s.isAtRest()) break;
  }
  kf.push({ transform: "none" });
  return kf;
}

/**
 * The bag page (FRONTEND.md 4.4): backdrop plus a white sheet that springs up, the big paper bag
 * half above it (drag it to shake the bread around), the lines with − n +, the subtotal and
 * 去结算 (the arrow zooms out first). Esc, the close button and the backdrop close it; focus
 * stays inside while it is open. Rendered by BagBar (in a portal) only while open.
 */
export const BagSheet = forwardRef<BagSheetHandle, BagSheetProps>(function BagSheet(
  { products, maxQty, cart, items, count, subtotalCents, orderingEnabled, onIncrease, onDecrease, onCheckout, onClose },
  ref,
) {
  const { reduced } = useMotionPrefs();
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const bagWrapRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const bagRef = useRef<PaperBagHandle>(null);
  const { ref: swingRef, kick } = useSwing();
  const closing = useRef(false);
  const going = useRef(false);

  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = cart
    .map((i) => ({ item: i, product: byId.get(i.productId) }))
    .filter((l): l is { item: CartItem; product: MenuProduct } => !!l.product && l.item.qty > 0);

  useImperativeHandle(
    ref,
    () => ({
      land(l) {
        bagRef.current?.drop(l.productId, l.count, l.xFrac);
        if (l.first) {
          kick(46);
          bagRef.current?.squash("land");
        }
      },
    }),
    [kick],
  );

  // Opening: backdrop fade, spring slide, the bag drops in and swings, the bread hops.
  useEffect(() => {
    play(backdropRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 250 }, reduced);
    if (reduced) {
      play(sheetRef.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 150 }, true);
    } else {
      const kf = springKeyframes();
      play(sheetRef.current, kf, { duration: kf.length * (1000 / 60), easing: "linear" }, false);
      play(
        bagWrapRef.current,
        [{ transform: "translateY(60px) rotate(-6deg)" }, { transform: "none" }],
        { duration: 700, delay: 60, easing: "cubic-bezier(.3,1.5,.5,1)", fill: "backwards" },
        false,
      );
      kick(20);
      bagRef.current?.jolt(-2600, 90);
    }
    const focus = setTimeout(() => closeRef.current?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opening animation runs once
  }, []);

  const requestClose = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    play(backdropRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 280, fill: "forwards" }, reduced);
    const a = play(
      sheetRef.current,
      [
        { transform: "none", opacity: 1 },
        { transform: "translateY(105%)", opacity: 0 },
      ],
      { duration: 340, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" },
      reduced,
    );
    void done(a).then(onClose);
  }, [reduced, onClose]);

  // Esc closes; Tab stays inside the dialog (also when focus has drifted out to the page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        requestClose();
        return;
      }
      const sheet = sheetRef.current;
      if (e.key !== "Tab" || !sheet) return;
      const nodes = Array.from(sheet.querySelectorAll<HTMLElement>("button:not(:disabled)"));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      const inside = !!active && sheet.contains(active);
      if (e.shiftKey && (active === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const checkoutDisabled = !orderingEnabled || count === 0;
  const checkout = async () => {
    if (going.current || checkoutDisabled) return;
    going.current = true;
    await arrowZoom(ctaRef.current, reduced);
    going.current = false;
    onCheckout();
  };

  return (
    <>
      <div
        ref={backdropRef}
        className="fixed inset-0 z-50 bg-c-ink/50"
        onClick={requestClose}
        data-testid="bag-backdrop"
      />
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={b.bagName}
        className="fixed inset-x-0 bottom-0 z-[51] mx-auto flex max-h-[min(88svh,calc(100svh-120px))] max-w-[430px] flex-col rounded-t-[28px] bg-c-paper"
        data-testid="bag-sheet"
      >
        <div
          ref={bagWrapRef}
          data-bag-target="sheet"
          className="absolute top-[-104px] left-1/2 z-[2] ml-[-65px]"
        >
          <div ref={swingRef} className="origin-bottom">
            <PaperBag ref={bagRef} width={130} items={items} shakeable />
          </div>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={requestClose}
          aria-label={b.closeBag}
          className="absolute top-2.5 right-2.5 z-[3] grid size-11 place-items-center rounded-full text-c-ink"
          data-testid="bag-close"
        >
          <CloseIcon className="size-5" />
        </button>

        <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-5 pt-28">
          <h2 className="font-display m-0 text-center text-[26px] leading-[1.1] tracking-[-0.04em] text-c-ink">{b.bagName}</h2>

          {lines.length === 0 ? (
            <p className="px-5 pt-[18px] pb-2 text-center text-sm leading-relaxed text-c-grey" data-testid="bag-empty">
              {b.emptyBag}
            </p>
          ) : (
            <ul className="mt-3 list-none p-0" data-testid="bag-lines">
              {lines.map(({ item, product }, i) => (
                <li
                  key={item.productId}
                  className="bag-ln grid grid-cols-[62px_1fr_auto] items-center gap-x-3.5 border-b border-c-line py-3.5"
                  style={{ "--i": i } as React.CSSProperties}
                  data-testid="bag-line"
                  data-product-id={item.productId}
                >
                  <div className="size-[62px] overflow-hidden rounded-xl bg-c-wash">
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
                    ) : (
                      <Logo className="size-full object-contain p-3 opacity-40" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[15.5px] leading-[1.3] font-bold text-c-ink">{product.name}</div>
                    {item.qty >= maxQty ? <div className="mt-0.5 text-xs leading-snug text-c-grey">{t.maxReached}</div> : null}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <RollText
                      value={formatCents(safeLineTotal(item.qty, product))}
                      className="font-num text-[17px] font-bold text-c-ink"
                    />
                    <div className="flex h-11 items-center rounded-full bg-c-wash">
                      <button
                        type="button"
                        aria-label={t.decrease}
                        onClick={() => {
                          kick(-24);
                          onDecrease(item.productId);
                        }}
                        className="grid size-11 place-items-center text-c-ink"
                        data-testid="bag-line-dec"
                      >
                        <MinusIcon className="size-4" />
                      </button>
                      <b
                        className="font-num min-w-5 text-center text-[15px] font-bold text-c-ink"
                        aria-label={fill(t.qtyLabel, { qty: item.qty })}
                        data-testid="bag-line-qty"
                      >
                        {item.qty}
                      </b>
                      <button
                        type="button"
                        aria-label={t.increase}
                        disabled={item.qty >= maxQty}
                        onClick={() => {
                          kick(30);
                          onIncrease(item.productId);
                        }}
                        className="grid size-11 place-items-center text-c-ink disabled:opacity-30"
                        data-testid="bag-line-inc"
                      >
                        <PlusIcon className="size-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pinned under the scrolling lines so 去结算 is always in reach. */}
        <div className="shrink-0 px-5 pt-5 pb-[calc(18px+env(safe-area-inset-bottom))]">
          <div className="mb-4 flex items-baseline justify-between">
            <span className="text-[15px] leading-none font-bold text-c-ink">{t.barSubtotalLabel}</span>
            <RollText
              value={formatCents(subtotalCents)}
              className="font-num text-[32px] font-bold text-c-ink"
              testId="bag-sheet-subtotal"
            />
          </div>
          <button
            ref={ctaRef}
            type="button"
            disabled={checkoutDisabled}
            onClick={checkout}
            className="flex h-[58px] w-full items-center justify-center gap-2.5 rounded-full bg-c-ink text-base leading-none font-bold text-c-paper transition-transform duration-200 active:scale-95 disabled:opacity-35"
            data-testid="bag-checkout"
          >
            {orderingEnabled ? t.goCheckout : t.checkoutClosed}
            <span className="inline-grid size-[22px] place-items-center overflow-hidden">
              <ArrowIcon className="size-5" />
            </span>
          </button>
        </div>
      </section>
    </>
  );
});
