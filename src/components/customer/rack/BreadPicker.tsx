"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import type { MenuProduct } from "@/lib/api";
import { productField } from "@/lib/field";
import { haptic, useMotionPrefs } from "@/lib/motion/react";
import { pushOverlay } from "@/lib/overlayHistory";
import { fill, weekdayTag } from "../format";
import { ProductPhoto } from "../ProductCard";

const t = copy.customer.home;
const FLIPS = 11;
const SPIN_MS = 3000;
/** Step-back fallback: Safari may refuse the history entry, so no popstate would ever come. */
const LEAVE_WAIT_MS = 300;

const pickAmong = (n: number, not: number) => {
  const r = Math.floor(Math.random() * (n - 1));
  return r >= not ? r + 1 : r;
};

/**
 * "帮我选" (owner 11/06): one photo spins on the spot, turning into another bread every half turn, and slows
 * to a stop on the pick; the page then takes the bread's own colour. Adding stays on the detail (D97), which
 * also asks for the flavour. Paused breads are never picked. All photos stay mounted while open, so a turn
 * never waits for a file; the rAF only runs while spinning.
 */
export function BreadPicker({
  products,
  onChoose,
}: {
  products: readonly MenuProduct[];
  onChoose: (productId: string, from: DOMRect) => void;
}) {
  const { reduced } = useMotionPrefs();
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const leave = useRef<(() => void) | null>(null);
  const raf = useRef(0);
  const [open, setOpen] = useState(false);
  // The list is fixed for one opening: a refetch must not swap the breads under a spin.
  const [pool, setPool] = useState<readonly MenuProduct[]>([]);
  const [pick, setPick] = useState(-1);
  const [spinning, setSpinning] = useState(false);

  const show = (i: number) => {
    card.current?.querySelectorAll<HTMLElement>("[data-pick]").forEach((el) => {
      el.dataset.on = el.dataset.pick === String(i) ? "true" : "false";
    });
  };

  const roll = useCallback(
    (list: readonly MenuProduct[], last: number) => {
      cancelAnimationFrame(raf.current);
      const target = last < 0 ? Math.floor(Math.random() * list.length) : pickAmong(list.length, last);
      setPick(target);
      const land = () => {
        show(target);
        if (card.current) card.current.style.transform = "";
        setSpinning(false);
        haptic();
      };
      if (reduced) return land();
      setSpinning(true);
      // The breads it passes through; the last one is the pick.
      const seq: number[] = [];
      for (let k = 0; k < FLIPS; k++) seq.push(pickAmong(list.length, k === 0 ? target : seq[k - 1]));
      seq.push(target);
      let shown = -1;
      const t0 = performance.now();
      const frame = (now: number) => {
        const u = Math.min(1, (now - t0) / SPIN_MS);
        const angle = 180 * FLIPS * (1 - (1 - u) ** 3);
        const k = Math.floor((angle + 90) / 180);
        if (k !== shown) {
          shown = k;
          show(seq[k]);
        }
        if (card.current) card.current.style.transform = `rotateY(${((angle + 90) % 180) - 90}deg)`;
        if (u < 1) raf.current = requestAnimationFrame(frame);
        else land();
      };
      raf.current = requestAnimationFrame(frame);
    },
    [reduced],
  );

  const shut = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (dialog.current?.open) dialog.current.close();
    setOpen(false);
    setSpinning(false);
  }, []);

  const start = () => {
    const list = products.filter((p) => p.status !== "PAUSED");
    if (list.length < 2) return;
    // The dialog and its photos must be in the page before the first turn.
    flushSync(() => {
      setPool(list);
      setPick(-1);
      setOpen(true);
    });
    dialog.current?.showModal();
    // Not on the × : the dialog itself takes the focus.
    dialog.current?.focus();
    leave.current = pushOverlay(shut);
    roll(list, -1);
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const close = () => {
    leave.current?.();
    leave.current = null;
    shut();
  };

  const choose = () => {
    const p = pool[pick];
    const rect = card.current?.getBoundingClientRect();
    if (!p || !rect) return close();
    // The detail adds its own history entry; pushing before the step back has landed would undo that entry.
    const go = () => {
      window.removeEventListener("popstate", go);
      clearTimeout(timer);
      shut();
      flushSync(() => onChoose(p.id, rect));
    };
    window.addEventListener("popstate", go);
    const timer = setTimeout(go, LEAVE_WAIT_MS);
    leave.current?.();
    leave.current = null;
  };

  const picked = pick >= 0 ? pool[pick] : undefined;
  const landed = open && !spinning && !!picked;
  const colours = landed ? productField(picked, pick) : null;
  const weekday = picked ? weekdayTag(picked) : null;
  const paint = colours
    ? ({ "--field": colours.field, "--fink": colours.ink, "--fink2": colours.ink2 } as React.CSSProperties)
    : undefined;

  return (
    <>
      <button
        type="button"
        className="hm-pick-open"
        onClick={start}
        disabled={products.filter((p) => p.status !== "PAUSED").length < 2}
        data-testid="picker-open"
      >
        {t.pickOpen}
      </button>
      {open ? (
        <dialog
          ref={dialog}
          className="hm-pick"
          style={paint}
          data-landed={landed ? "true" : undefined}
          aria-label={t.pickOpen}
          tabIndex={-1}
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
          data-testid="picker"
        >
          <button type="button" className="hm-pick-x" aria-label={t.pickClose} onClick={close} data-testid="picker-close">
            ×
          </button>
          <div className="hm-pick-stage">
            <div className="hm-pick-card" ref={card}>
              {pool.map((p, i) => (
                <span key={p.id} className="hm-pick-ph" data-pick={i} data-on="false">
                  <ProductPhoto product={p} className="h-full w-full" variant="detail" eager decorative />
                </span>
              ))}
            </div>
            {landed ? (
              <span className="hm-stamp hm-pick-stamp" data-testid="picker-stamp">
                {t.pickStamp}
              </span>
            ) : null}
          </div>
          <div className="hm-pick-words" aria-live="polite">
            {landed && picked ? (
              <>
                <h2 className="hm-name" data-testid="picker-name">
                  {picked.name}
                </h2>
                <div className="hm-price">
                  <b className="hm-n">{formatCents(picked.unitPriceCents)}</b>
                  {picked.bundlePriceCents !== null ? (
                    <span>{fill(t.bundlePrice, { size: picked.bundleSize, price: formatCents(picked.bundlePriceCents) })}</span>
                  ) : null}
                </div>
                {weekday ? <p className="hm-pick-note">{weekday}</p> : null}
              </>
            ) : null}
          </div>
          <div className="hm-pick-acts" data-hidden={landed ? undefined : "true"}>
            <button
              type="button"
              className="hm-pick-again"
              aria-label={t.pickAgain}
              disabled={!landed}
              onClick={() => roll(pool, pick)}
              data-testid="picker-again"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 12a8 8 0 1 1-2.6-5.9" />
                <path d="M20 4v5h-5" />
              </svg>
            </button>
            <button type="button" className="hm-viewp" disabled={!landed} onClick={choose} data-testid="picker-view">
              {t.viewHero}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
