"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { focusRing } from "@/components/ui/focus";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import type { MenuProduct } from "@/lib/api";
import type { CartItem } from "@/lib/cart";
import { useBagTarget } from "@/lib/flyToBag";
import { useMotionPrefs } from "@/lib/motion/react";
import { fill } from "../format";
import { EASE, arrowZoom } from "./anim";
import { subscribeBegin, subscribeLand, usePendingFlights } from "./bagFlights";
import { BagSheet, type BagSheetHandle } from "./BagSheet";
import { ArrowIcon } from "./icons";
import { PaperBag, type PaperBagHandle, type PaperBagItem } from "./PaperBag";
import { RollText } from "./RollText";
import { useSwing } from "./useSwing";
import "./bag.css";

const t = copy.customer.home;
const b = copy.customer.brand;

/** The pill opens the sheet this long after the tap; the arrow zoom plays meanwhile and is never awaited. */
const PILL_OPEN_DELAY_MS = 120;

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
 * Fixed bottom bar (FRONTEND.md 4.1 item 7): a small paper bag whose window shows the pile, a red
 * count badge, and a black pill with 你的纸袋, the amount (rolling digits) and a white round arrow.
 * Tapping the bag or the pill opens the bag sheet (the pill's arrow zooms out first). The bag is
 * the landing target of flights; on arrival it receives the bread, squashes and swings.
 */
export function BagBar({
  products,
  maxQty,
  cart,
  count,
  subtotalCents,
  orderingEnabled,
  onIncrease,
  onDecrease,
  onCheckout,
  compact,
}: BagBarProps) {
  const pathname = usePathname();
  const { ref: targetRef } = useBagTarget();
  const { reduced } = useMotionPrefs();
  const pending = usePendingFlights();
  const [open, setOpen] = useState(false);
  // The page can stay mounted (hidden) behind /checkout: a sheet left open must not wait there and
  // open again, pushing its history entry, when the customer comes back.
  const [openPath, setOpenPath] = useState(pathname);
  if (openPath !== pathname) {
    setOpenPath(pathname);
    if (open) setOpen(false);
  }
  const [live, setLive] = useState("");
  const miniRef = useRef<PaperBagHandle>(null);
  const sheetRef = useRef<BagSheetHandle>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { ref: swingRef, kick } = useSwing();

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const nameOf = useRef(byId);
  useEffect(() => {
    nameOf.current = byId;
  }, [byId]);

  // The bags show the cart minus the breads still in the air; a landing drops them in.
  const items = useMemo<PaperBagItem[]>(
    () =>
      // Only products on the menu: the same set the count, subtotal and sheet lines use.
      cart
        .filter((i) => byId.has(i.productId))
        .map((i) => ({
          productId: i.productId,
          imageUrl: byId.get(i.productId)?.imageUrl ?? null,
          qty: Math.max(0, i.qty - (pending.get(i.productId) ?? 0)),
        })),
    [cart, byId, pending],
  );

  // The red badge counts what has landed in the bag: the bread still in the air is not in yet.
  const landed = useMemo(() => items.reduce((sum, i) => sum + i.qty, 0), [items]);
  const shown = Math.min(count, landed);
  const prevShown = useRef(shown);
  useEffect(() => {
    // Pops when more bread lands (or is added in the sheet) while the badge is already showing.
    const was = prevShown.current;
    prevShown.current = shown;
    if (reduced || was <= 0 || shown <= was) return;
    badgeRef.current?.animate?.(
      [{ transform: "scale(1)" }, { transform: "scale(1.22)", offset: 0.4 }, { transform: "scale(1)" }],
      { duration: 280, easing: EASE },
    );
  }, [shown, reduced]);

  useEffect(
    () =>
      subscribeLand((l) => {
        const sheet = sheetRef.current;
        if (l.target === "sheet" && sheet) {
          sheet.land(l);
          return;
        }
        miniRef.current?.drop(l.productId, l.count, l.xFrac);
        if (l.first) {
          kick(46);
          miniRef.current?.squash("land");
        }
      }),
    [kick],
  );

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeBegin((f) => {
      const name = nameOf.current.get(f.productId)?.name;
      if (!name) return;
      setLive("");
      clearTimeout(timer);
      timer = setTimeout(() => setLive(fill(b.addedToBag, { name, qty: f.count })), 30);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  // `from` is what gets focus back on close (Safari does not focus a button on click).
  const openSheet = useCallback(
    (from: HTMLElement | null) => {
      if (open) return;
      opener.current = from;
      setOpen(true);
    },
    [open],
  );

  // The arrow zooms while the sheet is already on its way: opening never waits for it.
  const onPill = () => {
    if (open || openTimer.current !== undefined) return;
    void arrowZoom(pillRef.current, reduced);
    if (reduced) {
      openSheet(pillRef.current);
      return;
    }
    openTimer.current = setTimeout(() => {
      openTimer.current = undefined;
      openSheet(pillRef.current);
    }, PILL_OPEN_DELAY_MS);
  };
  useEffect(() => () => clearTimeout(openTimer.current), []);

  const closeSheet = useCallback(() => setOpen(false), []);

  // Once the bar is live again (not inert), focus goes back to what opened the sheet.
  useEffect(() => {
    if (open) return;
    const el = opener.current;
    opener.current = null;
    if (el && el.isConnected) el.focus({ preventScroll: true });
  }, [open]);

  return (
    <>
      <div
        className={`pointer-events-none fixed inset-x-0 bottom-0 z-[48] mx-auto flex max-w-[430px] items-end gap-3 px-4 safe-x pb-[calc(14px+env(safe-area-inset-bottom))] transition-[opacity,transform] duration-300 ${
          open ? "translate-y-[30px] opacity-0" : ""
        }`}
        inert={open}
        data-testid="bag-bar"
      >
        <button
          ref={targetRef as React.RefObject<HTMLButtonElement | null>}
          type="button"
          onClick={(e) => openSheet(e.currentTarget)}
          data-bag-target="bar"
          className={`pointer-events-auto relative mb-0.5 shrink-0 [filter:drop-shadow(0_10px_14px_rgba(0,0,0,0.25))] ${focusRing}`}
        >
          <span className="sr-only">{b.openBag}</span>
          <span className="sr-only" data-testid="bag-count">
            {fill(t.barCount, { count })}
          </span>
          <div ref={swingRef} className="origin-bottom">
            <PaperBag ref={miniRef} width={52} items={items} />
          </div>
          <span
            ref={badgeRef}
            aria-hidden="true"
            className={`font-num absolute top-1.5 -right-1.5 h-[22px] min-w-[22px] rounded-full bg-c-red px-1.5 text-center text-[13px] leading-[22px] font-bold text-c-paper transition-transform duration-[350ms] ease-[var(--ease)] ${
              shown > 0 ? "scale-100" : "scale-0"
            }`}
            data-testid="bag-badge"
          >
            {shown}
          </span>
        </button>
        <button
          ref={pillRef}
          type="button"
          onClick={onPill}
          inert={compact}
          className={`pointer-events-auto flex h-[60px] flex-1 items-center justify-between rounded-full bg-c-ink pr-2 pl-[22px] text-c-paper shadow-[0_14px_30px_-12px_rgba(0,0,0,0.55)] transition-[transform,opacity] duration-[350ms] ease-[var(--ease)] active:scale-95 ${focusRing} ${
            compact ? "pointer-events-none translate-x-10 opacity-0" : ""
          }`}
          data-testid="bag-pill"
        >
          <b className="shrink-0 text-[15px] leading-none font-bold whitespace-nowrap">{b.bagName}</b>
          <span className="flex min-w-0 items-center gap-3">
            <RollText
              value={formatCents(subtotalCents)}
              className="font-num text-[clamp(17px,5.6vw,21px)] font-bold whitespace-nowrap"
              testId="bag-subtotal"
            />
            <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-c-paper text-c-ink">
              <ArrowIcon className="size-[18px]" />
            </span>
          </span>
        </button>
      </div>
      <div className="sr-only" aria-live="polite" data-testid="bag-live">
        {live}
      </div>
      {open ? (
        <BagSheet
          ref={sheetRef}
          products={products}
          maxQty={maxQty}
          cart={cart}
          items={items}
          count={count}
          subtotalCents={subtotalCents}
          orderingEnabled={orderingEnabled}
          onIncrease={onIncrease}
          onDecrease={onDecrease}
          onCheckout={onCheckout}
          onClose={closeSheet}
        />
      ) : null}
    </>
  );
}
