"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { copy } from "@/copy";
import { formatCents } from "@/domain/pricing";
import type { MenuProduct } from "@/lib/api";
import { useMotionPrefs } from "@/lib/motion/react";
import { fill, safeLineTotal } from "../format";
import { ProductPhoto } from "../ProductCard";
import { bindDrag } from "./drag";
import { DownIcon, LeftIcon, MinusIcon, PlusIcon, RightIcon } from "./icons";
import { Peg } from "./Peg";
import { RollingText } from "./RollingText";

const b = copy.customer.brand;
const t = copy.customer.home;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** Pull this far (px) and the photo flies back to the rope. */
export const PULL_CLOSE_PX = 90;

export interface DetailHandle {
  /**
   * Fly the photo to `to` (the rope card's photo rect, or null) and fade the page out.
   * Resolves when it is done; the caller then unmounts the detail.
   */
  close(to: DOMRect | null): Promise<void>;
}

export interface DetailProps {
  products: readonly MenuProduct[];
  /** Product shown first (the card that was taken down). */
  startIndex: number;
  /** Where the photo starts: the rope card's hanging block on screen. */
  from: { left: number; top: number; width: number };
  maxQty: number;
  /** How many of a product are in the bag already. */
  inCart: (productId: string) => number;
  /** Prev / next changed the product (the page recolours and the rope follows). */
  onIndexChange: (i: number) => void;
  /** Hang back (chevron button, pull-down, Esc is handled by the page). */
  onClose: () => void;
  /** Add `qty` of `product` to the bag; `from` is the photo's rect. */
  onAdd: (product: MenuProduct, qty: number, from: DOMRect) => void;
  ref?: Ref<DetailHandle>;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The taken-down bread (FRONTEND.md 4.2): colour field, photo with peg, details, sticky add button. */
export function Detail({ products, startIndex, from, maxQty, inCart, onIndexChange, onClose, onAdd, ref }: DetailProps) {
  const { reduced } = useMotionPrefs();
  const n = products.length;
  const [i, setI] = useState(startIndex);
  const [qty, setQty] = useState(1);
  const product = products[i];
  const root = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const ph = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const cta = useRef<HTMLButtonElement>(null);
  const hang = useRef<HTMLButtonElement>(null);
  const dir = useRef(0);
  const busy = useRef(false);
  /** Set once hanging back has started: prev / next must not change anything any more. */
  const closing = useRef(false);
  /** A prev/next tap that arrived while the photo was still changing: applied right after. */
  const queued = useRef(0);
  const mounted = useRef(false);
  const latest = useRef({ onClose, reduced });
  useLayoutEffect(() => {
    latest.current = { onClose, reduced };
  });

  // ---- open: the photo flies from the rope into place (FLIP), the page fades in ----
  useLayoutEffect(() => {
    const el = ph.current;
    const r = root.current;
    if (!el || !r) return;
    const fade = (x: HTMLElement | null, ms: number, delay = 0) =>
      x?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: ms, delay, fill: "backwards" });
    if (reduced) {
      fade(bg.current, 200);
      fade(r.querySelector(".hm-dt-content"), 200);
      return;
    }
    const to = el.getBoundingClientRect();
    const sx = from.width / to.width;
    el.animate?.(
      [
        {
          transform: `translate(${from.left - to.left}px,${from.top - to.top + 10}px) scale(${sx}) perspective(900px) rotateY(-24deg)`,
          transformOrigin: "0 0",
        },
        { transform: "translate(0,-8px) scale(1.02) perspective(900px) rotateY(0)", transformOrigin: "0 0", offset: 0.7 },
        { transform: "none", transformOrigin: "0 0" },
      ],
      { duration: 620, easing: EASE },
    );
    fade(bg.current, 360);
    body.current?.animate?.(
      [
        { opacity: 0, transform: "translateY(46px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 620, delay: 120, easing: EASE, fill: "backwards" },
    );
    fade(top.current, 300, 200);
    // Runs once on mount: `from` is the rope card's position at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    hang.current?.focus({ preventScroll: true });
  }, []);

  const goRef = useRef(go);
  useLayoutEffect(() => {
    goRef.current = go;
  });

  // ---- prev / next: the photo flies out sideways, the new one flies in ----
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const el = ph.current;
    const bd = body.current;
    el?.getAnimations?.().forEach((a) => a.cancel());
    bd?.getAnimations?.().forEach((a) => a.cancel());
    const d = dir.current;
    if (!latest.current.reduced) {
      el?.animate?.(
        [
          { transform: `translateX(${60 * d}px) rotate(${4 * d}deg)`, opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 420, easing: EASE },
      );
      bd?.animate?.(
        [
          { opacity: 0, transform: "translateY(12px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 380, easing: EASE },
      );
    } else {
      el?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      bd?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    }
    busy.current = false;
    const next = queued.current;
    queued.current = 0;
    if (next !== 0) void goRef.current(Math.sign(next));
  }, [i]);

  async function go(d: number) {
    if (closing.current) return;
    if (busy.current) {
      queued.current += d;
      return;
    }
    const ni = clamp(i + d, 0, n - 1);
    if (ni === i) return;
    busy.current = true;
    dir.current = d;
    onIndexChange(ni);
    const el = ph.current;
    const bd = body.current;
    if (!reduced && el?.animate) {
      const out = el.animate(
        [
          { transform: "none", opacity: 1 },
          { transform: `translateX(${-60 * d}px) rotate(${-4 * d}deg)`, opacity: 0 },
        ],
        { duration: 200, easing: "ease-in", fill: "forwards" },
      );
      bd?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
      await out.finished.catch(() => {});
    }
    setI(ni);
    setQty(1);
  }

  // ---- pull down on the photo or the top bar: > 90 px and it flies back ----
  useEffect(() => {
    const photo = ph.current;
    const bar = top.current;
    const bd = body.current;
    const scroller = root.current;
    if (!photo || !bar || !bd || !scroller) return;
    const apply = (dy: number) => {
      const ty = dy <= PULL_CLOSE_PX ? dy * 0.8 : 72 + (dy - PULL_CLOSE_PX) * 0.3;
      const s = 1 - ty / 900;
      photo.style.transformOrigin = "0 0";
      photo.style.transform = `translate(${((1 - s) * photo.offsetWidth) / 2}px,${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
      bd.style.transform = `translateY(${ty.toFixed(1)}px)`;
    };
    const offs = [photo, bar].map((zone) =>
      bindDrag(zone, {
        axis: "y",
        lockPx: 4,
        canStart: (target) => !target?.closest("button") && scroller.scrollTop <= 2 && !busy.current,
        shouldClaim: (_dx, dy) => dy > 0,
        onDrag: (_dx, dy) => apply(Math.max(0, dy)),
        onEnd: (end) => {
          if (!end.dragged) return;
          if (!end.cancelled && end.dy > PULL_CLOSE_PX) {
            latest.current.onClose();
            return;
          }
          [photo, bd].forEach((x) => {
            const cur = x.style.transform;
            x.style.transform = "";
            x.style.transformOrigin = "";
            x.animate?.([{ transform: cur || "none", transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }], {
              duration: 380,
              easing: EASE,
            });
          });
        },
      }),
    );
    return () => offs.forEach((off) => off());
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      async close(to) {
        const r = root.current;
        const el = ph.current;
        if (!r || !el) return;
        closing.current = true;
        r.style.pointerEvents = "none";
        dock.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" });
        if (latest.current.reduced || !to || typeof el.animate !== "function") {
          const a = r.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
          await a?.finished.catch(() => {});
          return;
        }
        // Start from wherever the pull left the photo, end on the rope card's photo.
        const cur = el.style.transform;
        el.style.transform = "";
        el.style.transformOrigin = "0 0";
        const f = el.getBoundingClientRect();
        const sx = to.width / f.width;
        const fly = el.animate(
          [
            { transform: cur || "none", transformOrigin: "0 0" },
            { transform: `translate(${to.left - f.left}px,${to.top - f.top}px) scale(${sx})`, transformOrigin: "0 0" },
          ],
          { duration: 480, easing: EASE, fill: "forwards" },
        );
        body.current?.animate?.(
          [
            { opacity: 1, transform: body.current.style.transform || "none" },
            { opacity: 0, transform: "translateY(30px)" },
          ],
          { duration: 260, easing: EASE, fill: "forwards" },
        );
        top.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" });
        if (bg.current) bg.current.style.opacity = "0";
        await fly.finished.catch(() => {});
      },
    }),
    [],
  );

  if (!product) return null;
  const paused = product.status === "PAUSED";
  const room = Math.max(0, maxQty - inCart(product.id));
  const q = clamp(qty, 1, Math.max(1, room));
  const sum = formatCents(safeLineTotal(q, product));
  const canAdd = !paused && room > 0;

  const add = () => {
    const rect = ph.current?.getBoundingClientRect();
    if (!rect || !canAdd) return;
    onAdd(product, q, rect);
    setQty(1);
    cta.current?.animate?.([{ transform: "scale(.95)" }, { transform: "none" }], { duration: 260, easing: EASE });
  };

  return (
    <div ref={root} className="hm-detail" role="dialog" aria-modal="true" aria-label={product.name} data-testid="detail">
      <div ref={bg} className="hm-detail-bg" aria-hidden="true" />
      <div className="hm-dt-content">
        <div ref={top} className="hm-dt-top">
          <button ref={hang} type="button" className="hm-tbtn" aria-label={b.hangBack} onClick={onClose} data-testid="detail-close">
            <DownIcon />
          </button>
          <div className="hm-dt-nav">
            <button type="button" aria-label={b.prevProduct} disabled={i === 0} onClick={() => go(-1)} data-testid="detail-prev">
              <LeftIcon />
            </button>
            <span className="hm-n" data-testid="detail-pos">
              {i + 1} / {n}
            </span>
            <button type="button" aria-label={b.nextProduct} disabled={i === n - 1} onClick={() => go(1)} data-testid="detail-next">
              <RightIcon />
            </button>
          </div>
        </div>
        <div ref={ph} className={`hm-dt-ph ${paused ? "is-paused" : ""}`}>
          <Peg />
          <div className="hm-face">
            <ProductPhoto product={product} className="h-full w-full" eager decorative />
          </div>
        </div>
        <div ref={body} className="hm-dt-body">
          <h2 className="hm-dt-name" data-testid="detail-name">
            {product.name}
          </h2>
          {product.description ? <p className="hm-dt-desc">{product.description}</p> : null}
          <div className="hm-dt-prices">
            <div>
              <b className="hm-n" data-testid="detail-unit">
                {formatCents(product.unitPriceCents)}
              </b>
            </div>
            {product.bundlePriceCents !== null ? (
              <div>
                <b className="hm-n" data-testid="detail-bundle">
                  {formatCents(product.bundlePriceCents)}
                </b>
                <small>{fill(t.bundleSize, { size: product.bundleSize })}</small>
              </div>
            ) : null}
          </div>
          {product.leadDays > 1 ? (
            <p className="hm-dt-lead" data-testid="detail-lead">
              {copy.customer.checkout.leadDaysHint}
            </p>
          ) : null}
          <div className="hm-dt-act">
            <span />
            <span className="hm-stp">
              <button type="button" aria-label={t.decrease} disabled={q <= 1} onClick={() => setQty(q - 1)} data-testid="detail-dec">
                <MinusIcon />
              </button>
              <b className="hm-n" aria-label={fill(t.qtyLabel, { qty: q })} data-testid="detail-qty">
                <RollingText value={String(q)} />
              </b>
              <button type="button" aria-label={t.increase} disabled={q >= room} onClick={() => setQty(q + 1)} data-testid="detail-inc">
                <PlusIcon />
              </button>
            </span>
          </div>
          {paused ? <p className="hm-dt-note">{t.paused}</p> : room <= 0 ? <p className="hm-dt-note">{t.maxReached}</p> : null}
        </div>
        <div ref={dock} className="hm-dt-dock">
          <button ref={cta} type="button" className="hm-cta" disabled={!canAdd} onClick={add} data-testid="detail-add">
            {b.addToBag} {b.addSeparator} <RollingText value={sum} className="hm-n" />
          </button>
        </div>
      </div>
    </div>
  );
}
