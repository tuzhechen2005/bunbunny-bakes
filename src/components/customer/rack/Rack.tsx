"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { ShinyText } from "@/components/reactbits/ShinyText";
import { copy } from "@/copy";
import type { MenuProduct } from "@/lib/api";
import type { CartItem } from "@/lib/cart";
import { GestureTracker, rubberBand, snapTarget } from "@/lib/motion";
import { useMotionPrefs } from "@/lib/motion/react";
import { fill, priceText } from "../format";
import { pitch } from "./layout";
import { PhotoFace } from "./PhotoFace";
import { RackDetail } from "./RackDetail";
import { RopeScene, SAG } from "./scene";

const t = copy.customer.home;
const b = copy.customer.brand;
const r = b.rack;

/** Distance of the rope from the top of the stage, px. */
const ROPE_Y = 20;
/** Height of the caption strip under the photo, px. */
const CAPTION = 34;
/** Frame padding around the photo (polaroid border), px. */
const PAD = 8;

export interface RackProps {
  /** Menu products in display order (the server already orders them). */
  products: readonly MenuProduct[];
  /** Max quantity per item (Menu.maxQtyPerItem). */
  maxQty: number;
  cart: readonly CartItem[];
  /** Put one more into the bag. The caller updates the cart (cart.increment) and may fly to bag. */
  onAdd: (productId: string) => void;
  /** Called when a product is taken off the rope (the detail view opens inside the rack). */
  onOpenDetail?: (productId: string) => void;
}

/**
 * "今日出炉": square photos pegged to a horizontal rope. Drag or fling to move the rope, tap the
 * centre photo to take it down (detail view), tap a side photo to bring it to the centre.
 * Physics: src/lib/motion (spring for the rope, one pendulum per peg), driven by `RopeScene`.
 */
export function Rack({ products, maxQty, cart, onAdd, onOpenDetail }: RackProps) {
  const { reduced, degraded } = useMotionPrefs();
  const count = products.length;
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, Math.max(0, count - 1));
  const [width, setWidth] = useState(0);
  const [detail, setDetail] = useState<{ from: DOMRect | null } | null>(null);

  const [scene] = useState(() => new RopeScene());
  const stageRef = useRef<HTMLDivElement>(null);
  const photoRefs = useRef<(HTMLElement | null)[]>([]);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tracker = useRef(new GestureTracker());
  const drag = useRef({ active: false, captured: false, startPos: 0, lastDx: 0 });
  const suppressClick = useRef(false);
  const restoreFocus = useRef(false);
  const indexRef = useRef(index);
  const countRef = useRef(count);
  const prefsRef = useRef({ reduced, degraded });

  useLayoutEffect(() => {
    indexRef.current = index;
    countRef.current = count;
    prefsRef.current = { reduced, degraded };
  });

  // Measure the stage.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Hand the scene its inputs after every render that can change layout.
  useLayoutEffect(() => {
    scene.configure(count, width, reduced, degraded);
  }, [scene, count, width, reduced, degraded]);

  useEffect(() => () => scene.dispose(), [scene]);

  // After the detail closes (the stage is no longer inert), put focus back on the card.
  useEffect(() => {
    if (!detail && restoreFocus.current) {
      restoreFocus.current = false;
      btnRefs.current[indexRef.current]?.focus({ preventScroll: true });
    }
  }, [detail]);

  const select = useCallback((i: number, focus = false) => {
    const next = Math.max(0, Math.min(countRef.current - 1, i));
    setSelected(next);
    scene.goTo(next);
    if (focus) btnRefs.current[next]?.focus({ preventScroll: true });
  }, [scene]);

  const openDetail = useCallback(() => {
    const p = products[index];
    if (!p) return;
    onOpenDetail?.(p.id);
    const rect = photoRefs.current[index]?.getBoundingClientRect() ?? null;
    setDetail({ from: rect });
  }, [products, index, onOpenDetail]);

  const onCardClick = (i: number) => {
    if (suppressClick.current) return;
    if (i === index) openDetail();
    else select(i);
  };

  // ---- drag / fling ----
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (detail || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (countRef.current < 2) return;
    tracker.current.start(e.clientX, e.clientY, e.timeStamp);
    drag.current = { active: true, captured: false, startPos: scene.spring.x, lastDx: 0 };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active) return;
    const dx = tracker.current.move(e.clientX, e.clientY, e.timeStamp);
    if (dx === null) return;
    if (!d.captured) {
      d.captured = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    d.lastDx = dx;
    if (prefsRef.current.reduced) return; // no live follow; the release decides
    const pos = rubberBand(d.startPos - dx / pitch(scene.size), 0, countRef.current - 1);
    scene.dragTo(pos);
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    const wasDrag = tracker.current.axis === "x";
    const { velocity, fling } = tracker.current.end(e.timeStamp);
    if (!wasDrag) return;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 80);
    const n = countRef.current;
    const startIdx = Math.round(d.startPos);
    let target: number;
    if (prefsRef.current.reduced) {
      const dir = fling !== 0 ? fling : Math.abs(d.lastDx) > 40 ? Math.sign(d.lastDx) : 0;
      target = snapTarget(startIdx, startIdx, (dir === 0 ? 0 : -dir) as -1 | 0 | 1, n);
    } else if (cancelled) {
      target = snapTarget(scene.spring.x, startIdx, 0, n);
    } else {
      target = snapTarget(scene.spring.x, startIdx, (fling === 0 ? 0 : -fling) as -1 | 0 | 1, n);
    }
    setSelected(target);
    scene.release(target, (-velocity * 1000) / pitch(scene.size));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (detail) return;
    if (e.key === "ArrowLeft") select(index - 1, true);
    else if (e.key === "ArrowRight") select(index + 1, true);
    else if (e.key === "Home") select(0, true);
    else if (e.key === "End") select(count - 1, true);
    else return;
    e.preventDefault();
  };

  // ---- detail ("take down") ----
  const goInstant = (i: number) => {
    const next = Math.max(0, Math.min(count - 1, i));
    setSelected(next);
    scene.goTo(next, true);
  };
  const getTargetRect = useCallback(
    () => photoRefs.current[indexRef.current]?.getBoundingClientRect() ?? null,
    [],
  );
  const onClosed = useCallback(() => {
    setDetail(null);
    restoreFocus.current = true;
    scene.kick(indexRef.current);
  }, [scene]);

  const cardW = scene.size;
  const cardH = cardW - PAD * 2 + PAD + CAPTION; // photo + top padding + caption
  const stageH = ROPE_Y + 4 + cardH + SAG + 20;
  const current = products[index];
  const taken = detail ? index : -1;

  return (
    <section aria-label={b.rackTitle} data-testid="rack" className="select-none">
      <h2 className="px-4 font-serif text-2xl">
        <ShinyText text={b.rackTitle} />
      </h2>

      <div
        ref={stageRef}
        className="relative mt-1 overflow-hidden"
        style={{ height: stageH, perspective: 900, touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => onPointerEnd(e, false)}
        onPointerCancel={(e) => onPointerEnd(e, true)}
        onKeyDown={onKeyDown}
        inert={detail ? true : undefined}
      >
        <svg
          className="pointer-events-none absolute top-0 left-0"
          width={Math.max(width, 1)}
          height={ROPE_Y + SAG + 8}
          aria-hidden="true"
          focusable="false"
        >
          <path
            d={`M -10 ${ROPE_Y} Q ${width / 2} ${ROPE_Y + 2 * SAG} ${width + 10} ${ROPE_Y}`}
            fill="none"
            stroke="var(--kraft)"
            strokeWidth={3.5}
            strokeLinecap="round"
          />
          <path
            d={`M -10 ${ROPE_Y} Q ${width / 2} ${ROPE_Y + 2 * SAG} ${width + 10} ${ROPE_Y}`}
            fill="none"
            stroke="var(--ink)"
            strokeOpacity={0.28}
            strokeWidth={3.5}
            strokeDasharray="1.5 4"
          />
        </svg>

        <ul aria-label={r.listLabel} className="m-0 list-none p-0">
          {products.map((p, i) => {
            const paused = p.status === "PAUSED";
            const label = fill(r.cardLabel, { name: p.name, price: paused ? t.paused : priceText(p) });
            return (
              <li
                key={p.id}
                ref={(el) => {
                  scene.outer[i] = el;
                }}
                className="absolute top-0"
                style={{
                  left: `calc(50% - ${cardW / 2}px)`,
                  width: cardW,
                  height: ROPE_Y + 4 + cardH,
                  transformOrigin: `50% ${ROPE_Y}px`,
                  willChange: "transform",
                }}
                data-testid="rack-item"
                data-product-id={p.id}
                data-selected={i === index ? "true" : undefined}
                data-paused={paused ? "true" : undefined}
              >
                <div
                  ref={(el) => {
                    scene.inner[i] = el;
                  }}
                  className="absolute inset-x-0"
                  style={{ top: ROPE_Y + 4, transformOrigin: "50% -4px" }}
                >
                  <button
                    ref={(el) => {
                      btnRefs.current[i] = el;
                    }}
                    type="button"
                    tabIndex={i === index ? 0 : -1}
                    aria-label={label}
                    aria-current={i === index ? "true" : undefined}
                    data-testid="rack-card"
                    className="block w-full rounded-[4px] text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
                    onClick={() => onCardClick(i)}
                  >
                    <span
                      className={`relative block bg-card px-2 pt-2 shadow-[0_8px_16px_-8px_color-mix(in_srgb,var(--ink)_45%,transparent)] ${taken === i ? "opacity-0" : ""}`}
                    >
                      <span
                        ref={(el) => {
                          photoRefs.current[i] = el;
                        }}
                        className={`relative block overflow-hidden bg-soft ${paused ? "opacity-60 grayscale" : ""}`}
                        style={{ width: cardW - PAD * 2, height: cardW - PAD * 2 }}
                      >
                        <PhotoFace product={p} markSize={Math.round(cardW * 0.28)} />
                      </span>
                      <span
                        className="flex items-center justify-center font-serif text-sm"
                        style={{ height: CAPTION }}
                      >
                        <span className="truncate">{p.name}</span>
                      </span>
                      {paused ? (
                        <span className="absolute top-4 right-3 rounded-full bg-foreground px-2 py-0.5 text-xs text-background">
                          {t.paused}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </div>
                {/* wooden peg: stays upright on the rope while the photo swings from it */}
                <svg
                  className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2"
                  style={{ top: ROPE_Y - 12 }}
                  width={16}
                  height={34}
                  viewBox="0 0 16 34"
                  aria-hidden="true"
                  focusable="false"
                >
                  <rect x="2" y="1" width="12" height="32" rx="4" fill="var(--kraft)" stroke="var(--ink)" strokeOpacity={0.45} />
                  <path d="M8 4 V30" stroke="var(--ink)" strokeOpacity={0.35} strokeWidth={1.5} />
                  <circle cx="8" cy="12" r="2" fill="var(--ink)" fillOpacity={0.5} />
                </svg>
              </li>
            );
          })}
        </ul>
      </div>

      {current ? (
        <div className="px-4 text-center" aria-live="polite">
          <p className="text-sm font-medium text-accent-strong" data-testid="rack-current">
            {current.status === "PAUSED" ? t.paused : priceText(current)}
          </p>
          <p className="mt-0.5 text-xs text-muted">{r.hint}</p>
        </div>
      ) : null}

      {detail && current && typeof document !== "undefined"
        ? createPortal(
            <RackDetail
              key="detail"
              product={current}
              position={index + 1}
              total={count}
              maxQty={maxQty}
              inBag={cart.find((i) => i.productId === current.id)?.qty ?? 0}
              fromRect={detail.from}
              reduced={reduced}
              getTargetRect={getTargetRect}
              onAdd={onAdd}
              onPrev={() => goInstant(index - 1)}
              onNext={() => goInstant(index + 1)}
              onClosed={onClosed}
            />,
            document.body,
          )
        : null}
    </section>
  );
}
