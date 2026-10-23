"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { copy } from "@/copy";
import type { MenuProduct } from "@/lib/api";
import { flyToBag } from "@/lib/flyToBag";
import { GestureTracker } from "@/lib/motion";
import { fill, priceText } from "../format";
import { PhotoFace } from "./PhotoFace";

const t = copy.customer.home;
const b = copy.customer.brand;
const r = b.rack;

/** Pull the photo down this far (px) to hang it back. */
export const PULL_CLOSE_PX = 90;
const SWIPE_PX = 50;
const OPEN_MS = 460;
const CLOSE_MS = 380;

export interface RackDetailProps {
  product: MenuProduct;
  /** 1-based position and total, for "2 / 4". */
  position: number;
  total: number;
  maxQty: number;
  /** Pieces of this product already in the bag. */
  inBag: number;
  /** Where the photo hangs on the rope (rect of the rack photo when opened); null = just fade. */
  fromRect: DOMRect | null;
  reduced: boolean;
  /** Rect of the rack photo of the *current* product, measured when closing. */
  getTargetRect: () => DOMRect | null;
  onAdd: (productId: string) => void;
  onPrev: () => void;
  onNext: () => void;
  /** Called once the photo is back on the rope (or the fade finished). */
  onClosed: () => void;
}

const stepBtn =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-xl font-semibold leading-none " +
  "border-accent text-accent active:bg-soft disabled:border-disabled disabled:text-disabled-ink disabled:bg-transparent " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const navBtn =
  "min-h-11 rounded-full px-4 text-base text-foreground active:bg-soft disabled:text-disabled-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function canAnimate(el: HTMLElement | null | undefined): el is HTMLElement {
  return !!el && typeof el.animate === "function";
}

/** Transform that puts an element laid out at `base` onto the rect `to` (top-left origin). */
function flipTransform(base: DOMRect, to: DOMRect): string {
  const s = base.width > 0 ? to.width / base.width : 1;
  return `translate(${to.left - base.left}px, ${to.top - base.top}px) scale(${s})`;
}

export function RackDetail({
  product,
  position,
  total,
  maxQty,
  inBag,
  fromRect,
  reduced,
  getTargetRect,
  onAdd,
  onPrev,
  onNext,
  onClosed,
}: RackDetailProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pullRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const closedOnce = useRef(false);
  const tracker = useRef(new GestureTracker());
  const pull = useRef({ active: false, captured: false, startX: 0, startY: 0, dy: 0 });
  const prevPosition = useRef(position);

  const paused = product.status === "PAUSED";
  const room = Math.max(0, maxQty - inBag);
  const [pend, setPend] = useState({ id: product.id, n: 1 });
  const pending = pend.id === product.id ? pend.n : 1;
  const setPending = (n: number) => setPend({ id: product.id, n });
  const shown = Math.min(Math.max(1, pending), Math.max(1, room));

  const finish = useCallback(() => {
    if (closedOnce.current) return;
    closedOnce.current = true;
    onClosed();
  }, [onClosed]);

  // Opening: the photo grows from the rope to the big slot while the page fades in.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const photo = photoRef.current;
    const content = contentRef.current;
    if (!canAnimate(panel)) return;
    panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced || !fromRect ? 180 : 260, easing: "ease-out" });
    if (reduced || !fromRect || !canAnimate(photo)) return;
    const to = photo.getBoundingClientRect();
    photo.style.transformOrigin = "0 0";
    photo.animate([{ transform: flipTransform(to, fromRect) }, { transform: "translate(0, 0) scale(1)" }], {
      duration: OPEN_MS,
      easing: "cubic-bezier(0.22, 1.25, 0.36, 1)",
    });
    if (canAnimate(content)) {
      content.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], {
        duration: 280,
        delay: 160,
        easing: "ease-out",
        fill: "backwards",
      });
    }
    // Runs once on mount: the rect it grows from is the one captured when the detail opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching to another product: slide the content in from the side.
  useEffect(() => {
    const dir = Math.sign(position - prevPosition.current);
    prevPosition.current = position;
    if (dir === 0) return;
    const el = pullRef.current?.parentElement;
    if (!canAnimate(el)) return;
    el.animate(
      [{ opacity: 0, transform: reduced ? "none" : `translateX(${dir * 24}px)` }, { opacity: 1, transform: "none" }],
      { duration: 220, easing: "ease-out" },
    );
  }, [position, reduced]);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const panel = panelRef.current;
    const photo = photoRef.current;
    const pullEl = pullRef.current;
    const content = contentRef.current;
    const target = getTargetRect();
    const safety = window.setTimeout(finish, 900);
    const done = () => {
      window.clearTimeout(safety);
      finish();
    };
    if (reduced || !target || !canAnimate(photo) || !canAnimate(panel) || !pullEl) {
      if (canAnimate(panel)) {
        const a = panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
        a.onfinish = done;
      } else {
        done();
      }
      return;
    }
    const cur = photo.getBoundingClientRect();
    photo.getAnimations().forEach((a) => a.cancel());
    pullEl.style.transform = "";
    pullEl.style.transition = "";
    const base = photo.getBoundingClientRect();
    photo.style.transformOrigin = "0 0";
    const fly = photo.animate([{ transform: flipTransform(base, cur) }, { transform: flipTransform(base, target) }], {
      duration: CLOSE_MS,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      fill: "forwards",
    });
    fly.onfinish = done;
    panel.animate([{ opacity: panel.style.opacity || 1 }, { opacity: 0 }], {
      duration: CLOSE_MS - 60,
      delay: 60,
      easing: "ease-in",
      fill: "forwards",
    });
    if (canAnimate(content)) content.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: "forwards" });
  }, [finish, getTargetRect, reduced]);

  // Esc closes, arrows switch product (on window: Safari does not focus buttons on click).
  const latest = useRef({ position, total, onPrev, onNext });
  useEffect(() => {
    latest.current = { position, total, onPrev, onNext };
  });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const l = latest.current;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowLeft" && l.position > 1) {
        e.preventDefault();
        l.onPrev();
      } else if (e.key === "ArrowRight" && l.position < l.total) {
        e.preventDefault();
        l.onNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Keep Tab inside the dialog.
  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? []);
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // ---- pull down to hang back, swipe sideways for prev/next ----
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (closing.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    tracker.current.start(e.clientX, e.clientY, e.timeStamp);
    pull.current = { active: true, captured: false, startX: e.clientX, startY: e.clientY, dy: 0 };
    if (pullRef.current) pullRef.current.style.transition = "";
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = pull.current;
    if (!p.active) return;
    tracker.current.move(e.clientX, e.clientY, e.timeStamp);
    const axis = tracker.current.axis;
    if (axis === null) return;
    if (!p.captured) {
      p.captured = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (axis === "y") {
      const dy = Math.max(0, e.clientY - p.startY);
      p.dy = dy;
      if (pullRef.current && !reduced) pullRef.current.style.transform = `translateY(${dy}px)`;
      if (panelRef.current) panelRef.current.style.opacity = String(1 - Math.min(dy / 400, 0.35));
    }
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const p = pull.current;
    if (!p.active) return;
    p.active = false;
    const axis = tracker.current.axis;
    const { fling } = tracker.current.end(e.timeStamp);
    if (axis === "y") {
      if (!cancelled && p.dy > PULL_CLOSE_PX) {
        close();
        return;
      }
      if (panelRef.current) panelRef.current.style.opacity = "";
      const el = pullRef.current;
      if (el) {
        if (canAnimate(el) && !reduced) {
          el.animate([{ transform: `translateY(${p.dy}px)` }, { transform: "translateY(0)" }], {
            duration: 240,
            easing: "cubic-bezier(0.22, 1.2, 0.36, 1)",
          });
        }
        el.style.transform = "";
      }
    } else if (axis === "x" && !cancelled) {
      const dx = e.clientX - p.startX;
      if (Math.abs(dx) > SWIPE_PX || fling !== 0) {
        const dir = fling !== 0 ? fling : Math.sign(dx);
        if (dir < 0 && position < total) onNext();
        else if (dir > 0 && position > 1) onPrev();
      }
    }
  };

  const add = () => {
    if (paused || room <= 0) return;
    for (let i = 0; i < shown; i++) onAdd(product.id);
    const from = photoRef.current?.getBoundingClientRect();
    if (from) flyToBag({ from, imageUrl: product.imageUrl, productId: product.id });
    setPending(1);
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={product.name}
      data-testid="rack-detail"
      className="paper-grain fixed inset-0 z-40 overflow-y-auto"
      onKeyDown={onPanelKeyDown}
    >
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-6 pt-3 pb-8">
        <div className="flex items-center justify-between">
          <button
            ref={closeRef}
            type="button"
            data-testid="rack-close"
            className="-ml-3 flex min-h-11 items-center gap-1 rounded-full px-3 text-base text-accent-strong active:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={close}
          >
            <span aria-hidden="true">‹</span> {r.hangBack}
          </button>
          <span className="text-sm text-muted tabular-nums" data-testid="rack-position">
            {fill(r.position, { index: position, total })}
          </span>
        </div>

        <div
          ref={pullRef}
          className="mt-3 flex justify-center"
          style={{ touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => onPointerEnd(e, false)}
          onPointerCancel={(e) => onPointerEnd(e, true)}
        >
          <div
            ref={photoRef}
            data-testid="rack-detail-photo"
            className={`aspect-square w-[min(calc(100vw-3rem),22rem,40svh)] overflow-hidden rounded-[6px] bg-soft shadow-[0_10px_24px_-12px_color-mix(in_srgb,var(--ink)_55%,transparent)] ${paused ? "opacity-60 grayscale" : ""}`}
          >
            <PhotoFace product={product} markSize={96} />
          </div>
        </div>

        <div ref={contentRef} className="mt-5 flex flex-1 flex-col">
          <div className="flex items-start gap-2">
            <h3 className="font-serif text-2xl leading-snug break-words" data-testid="rack-detail-name">
              {product.name}
            </h3>
            {paused ? (
              <span className="mt-1.5 shrink-0 rounded-full bg-soft px-2 py-0.5 text-xs text-muted">{t.paused}</span>
            ) : null}
          </div>
          {product.description ? <p className="mt-2 text-base break-words text-muted">{product.description}</p> : null}
          <p className="mt-3 text-base font-medium text-accent-strong" data-testid="rack-detail-price">
            {priceText(product)}
          </p>
          {inBag > 0 ? (
            <p className="mt-1 text-sm text-muted" data-testid="rack-in-bag">
              {fill(r.inBag, { qty: inBag })}
            </p>
          ) : null}

          <div className="mt-5 flex items-center gap-4">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={stepBtn}
                aria-label={t.decrease}
                disabled={paused || shown <= 1}
                onClick={() => setPending(shown - 1)}
              >
                −
              </button>
              <span
                className="min-w-8 text-center text-base font-semibold tabular-nums"
                aria-label={fill(t.qtyLabel, { qty: shown })}
                data-testid="rack-detail-qty"
              >
                {shown}
              </span>
              <button
                type="button"
                className={stepBtn}
                aria-label={t.increase}
                disabled={paused || shown >= room}
                onClick={() => setPending(shown + 1)}
              >
                +
              </button>
            </div>
            <button
              type="button"
              data-testid="rack-add"
              disabled={paused || room <= 0}
              className="min-h-12 flex-1 rounded-full bg-accent px-6 text-base font-semibold text-accent-ink active:bg-accent-strong disabled:bg-disabled disabled:text-disabled-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={add}
            >
              {paused ? t.paused : b.addToBag}
            </button>
          </div>
          {!paused && room <= 0 ? (
            <p className="mt-2 text-right text-xs text-danger" data-testid="rack-max-hint">
              {t.maxReached}
            </p>
          ) : null}

          <div className="mt-auto flex items-center justify-between pt-6">
            <button type="button" className={navBtn} data-testid="rack-prev" disabled={position <= 1} onClick={onPrev}>
              ‹ {r.prev}
            </button>
            <span className="text-xs text-muted">{r.pullHint}</span>
            <button type="button" className={navBtn} data-testid="rack-next" disabled={position >= total} onClick={onNext}>
              {r.next} ›
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
