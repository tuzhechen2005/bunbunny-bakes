"use client";

import { useRouter } from "next/navigation";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { Sheet, type SheetHandle } from "@/components/ui/Sheet";
import { Stepper } from "@/components/ui/Stepper";
import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import type { MenuProduct } from "@/lib/api";
import { cart as cartStore, type CartItem } from "@/lib/cart";
import { useMotionPrefs } from "@/lib/motion/react";
import { BAG_ROW_WIDTH, photoUrl } from "@/lib/photo";
import { fill, safeLineTotal } from "../format";
import { EASE, arrowZoom, done, play } from "./anim";
import type { Landing } from "./bagFlights";
import { ArrowIcon, CloseIcon } from "./icons";
import { PaperBag, type PaperBagHandle, type PaperBagItem } from "./PaperBag";
import { RollText } from "./RollText";
import { useSwing } from "./useSwing";
import "./bag.css";

const t = copy.customer.home;
const b = copy.customer.brand;
const bagCopy = copy.customer.bag;

/** 去结算: the sheet grows to the full screen in this long while the arrow zooms (D-flow, J3). */
const EXPAND_MS = 280;
/** Lines and the paper bag fade out while it grows. */
const FADE_MS = 180;

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

/**
 * The bag page (FRONTEND.md 4.4): a bottom sheet with the big paper bag half above it (drag it to
 * shake the bread around), the lines with − n +, the subtotal and 去结算. 去结算 zooms the arrow
 * while the sheet grows to the full screen (the lines fade, the backdrop turns paper) and only then
 * navigates, so the checkout page opens on the same white screen. Esc, the close button, the
 * backdrop, a pull down and the browser Back button close it; focus stays inside while it is open.
 */
export const BagSheet = forwardRef<BagSheetHandle, BagSheetProps>(function BagSheet(
  { products, maxQty, cart, items, count, subtotalCents, orderingEnabled, onIncrease, onDecrease, onCheckout, onClose },
  ref,
) {
  const router = useRouter();
  const { reduced } = useMotionPrefs();
  const sheetRef = useRef<SheetHandle>(null);
  const bagWrapRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const bagRef = useRef<PaperBagHandle>(null);
  const { ref: swingRef, kick } = useSwing();
  const going = useRef(false);
  // While 去结算 runs the sheet can no longer be dismissed.
  const [leaving, setLeaving] = useState(false);
  // A product left the menu and was taken out of the bag: say so, once.
  const [removedNotice] = useState(() => cartStore.consumeRemovedNotice());

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

  // The checkout page is fetched while the customer looks at the bag.
  useEffect(() => {
    router.prefetch("/checkout");
  }, [router]);

  // Opening: the bag drops in and swings, the bread hops.
  useEffect(() => {
    if (reduced) return;
    play(
      bagWrapRef.current,
      [{ transform: "translateY(60px) rotate(-6deg)" }, { transform: "none" }],
      { duration: 700, delay: 60, easing: "cubic-bezier(.3,1.5,.5,1)", fill: "backwards" },
      false,
    );
    kick(20);
    bagRef.current?.jolt(-2600, 90);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opening animation runs once
  }, []);

  const checkoutDisabled = !orderingEnabled || count === 0;
  const checkout = async () => {
    if (going.current || checkoutDisabled) return;
    going.current = true;
    setLeaving(true);
    const sheet = sheetRef.current;
    // The history entry of the sheet is given up now, so Back from the checkout page lands on the home page.
    const released = sheet?.releaseHistory();
    const zoom = arrowZoom(ctaRef.current, reduced);
    const panel = sheet?.panel;
    const backdrop = sheet?.backdrop;
    if (!reduced && panel) {
      const h = panel.getBoundingClientRect().height;
      const full = `${window.innerHeight}px`;
      panel.style.pointerEvents = "none";
      const grow = panel.animate(
        [
          { height: `${h}px`, maxHeight: `${h}px`, borderRadius: "28px 28px 0 0" },
          { height: full, maxHeight: full, borderRadius: "0" },
        ],
        { duration: EXPAND_MS, easing: EASE, fill: "forwards" },
      );
      const fade = { duration: FADE_MS, fill: "forwards" as const };
      play(bodyRef.current, [{ opacity: 1 }, { opacity: 0 }], fade, false);
      play(bagWrapRef.current, [{ opacity: 1 }, { opacity: 0 }], fade, false);
      backdrop?.animate([{ backgroundColor: "var(--c-paper)" }], { duration: EXPAND_MS, easing: EASE, fill: "forwards" });
      await Promise.all([zoom, done(grow), released]);
    } else {
      await Promise.all([zoom, released]);
    }
    onCheckout();
  };

  return (
    <Sheet
      ref={sheetRef}
      label={b.bagName}
      onClosed={onClose}
      dismissible={!leaving}
      history
      initialFocus={closeRef}
      className="max-h-[min(88svh,calc(100svh-120px))]"
      panelTestId="bag-sheet"
      backdropTestId="bag-backdrop"
    >
      <div
        ref={bagWrapRef}
        data-bag-target="sheet"
        data-no-sheet-drag=""
        className="absolute top-[-104px] left-1/2 z-[2] ml-[-65px]"
      >
        <div ref={swingRef} className="origin-bottom">
          <PaperBag ref={bagRef} width={130} items={items} shakeable />
        </div>
      </div>
      <button
        ref={closeRef}
        type="button"
        onClick={() => sheetRef.current?.close()}
        aria-label={b.closeBag}
        className={`absolute top-2.5 right-2.5 z-[3] grid size-11 place-items-center rounded-full text-c-ink ${focusRing}`}
        data-testid="bag-close"
      >
        <CloseIcon className="size-5" />
      </button>

      <div ref={bodyRef} data-sheet-scroll="" className="min-h-0 flex-1 overflow-auto overscroll-contain px-5 pt-28">
        <h2 className="font-display m-0 text-center text-[26px] leading-[1.1] tracking-[-0.04em] text-c-ink">{b.bagName}</h2>

        {removedNotice ? (
          <p role="status" className="mt-3 rounded-2xl bg-c-wash px-4 py-3 text-center text-sm leading-snug font-bold text-c-ink" data-testid="bag-notice">
            {bagCopy.removedNotice}
          </p>
        ) : null}

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
                    <img src={photoUrl(product.imageUrl, BAG_ROW_WIDTH)} alt="" loading="lazy" className="size-full object-cover" />
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
                  <Stepper
                    size="md"
                    tone="wash"
                    qty={item.qty}
                    canIncrease={item.qty < maxQty}
                    decreaseLabel={fill(bagCopy.decreaseNamed, { name: product.name })}
                    increaseLabel={fill(bagCopy.increaseNamed, { name: product.name })}
                    qtyLabel={fill(bagCopy.qtyNamed, { name: product.name, qty: item.qty })}
                    decreaseTestId="bag-line-dec"
                    increaseTestId="bag-line-inc"
                    qtyTestId="bag-line-qty"
                    onDecrease={() => {
                      kick(-24);
                      onDecrease(item.productId);
                    }}
                    onIncrease={() => {
                      kick(30);
                      onIncrease(item.productId);
                    }}
                  />
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
          className={`flex h-[58px] w-full items-center justify-center gap-2.5 rounded-full bg-c-ink text-base leading-none font-bold text-c-paper transition-transform duration-200 active:scale-95 disabled:opacity-35 ${focusRing}`}
          data-testid="bag-checkout"
        >
          {orderingEnabled ? t.goCheckout : t.checkoutClosed}
          <span className="inline-grid size-[22px] place-items-center overflow-hidden">
            <ArrowIcon className="size-5" />
          </span>
        </button>
      </div>
    </Sheet>
  );
});
