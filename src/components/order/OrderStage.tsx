"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { PaperBag, type PaperBagHandle, type PaperBagItem } from "@/components/customer/bag/PaperBag";
import { play } from "@/components/customer/bag/anim";
import { useMotionPrefs } from "@/lib/motion/react";
import { StampSvg } from "./StampSvg";
import type { OrderViewData } from "./types";
import "./order.css";

const BAG_WIDTH = 190;
const BAG_HEIGHT = BAG_WIDTH * 1.497;
const STAMPER_W = 150;
/** public/brand/stamper.webp is 300 x 382. */
const STAMPER_ASPECT = 382 / 300;
/** The impact lands this long after the sequence starts (prototype T). */
const IMPACT_AT = 1250;
const LAST_BAG_KEY = "bunbunny:lastBag";

/** Bag contents: the order's product photos, else the bread saved at checkout, else plain discs. */
function bagItems(order: Pick<OrderViewData, "orderNo" | "items">): PaperBagItem[] {
  const items: PaperBagItem[] = order.items.map((it, i) => ({
    productId: `i${i}`,
    imageUrl: it.imageUrl ?? null,
    qty: it.qty,
  }));
  if (items.some((it) => it.imageUrl)) return items;
  try {
    const saved = JSON.parse(sessionStorage.getItem(LAST_BAG_KEY) ?? "null") as {
      orderNo?: unknown;
      items?: { name?: unknown; imageUrl?: unknown }[];
    } | null;
    if (saved?.orderNo !== order.orderNo || !Array.isArray(saved.items)) return items;
    return items.map((it, i) => {
      const match = saved.items!.find((s) => s.name === order.items[i].name);
      return typeof match?.imageUrl === "string" ? { ...it, imageUrl: match.imageUrl } : it;
    });
  } catch {
    return items;
  }
}

function vibrate(pattern: number[]) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    /* haptics are optional */
  }
}

interface Props {
  order: Pick<OrderViewData, "orderNo" | "items" | "statusKind">;
  /** Just ordered (?new=1): play the fold + stamp sequence once. */
  fresh: boolean;
  /** The page column that shakes on impact. */
  shakeRef: RefObject<HTMLElement | null>;
  /** Called at the impact: the title and cards may rise now. */
  onImpact: () => void;
}

/**
 * The paper bag of the order page (FRONTEND.md 4.6). Normally already folded and stamped.
 * With `fresh`: the bag rises, folds, the wooden stamper slams down (squash, screen shake,
 * shockwave, ink splatter, jolt, haptic), lifts away and leaves the seal. Reduced motion
 * shows the end state at once.
 */
export function OrderStage({ order, fresh, shakeRef, onImpact }: Props) {
  const { reduced, degraded } = useMotionPrefs();
  const [playing] = useState(() => fresh && !reduced);
  const [folded, setFolded] = useState(!playing);
  const [stamperGone, setStamperGone] = useState(false);
  const stamped = order.statusKind !== "CANCELLED";

  const { orderNo, items: orderItems } = order;
  const items = useMemo(() => bagItems({ orderNo, items: orderItems }), [orderNo, orderItems]);

  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const bagRef = useRef<PaperBagHandle>(null);
  const impRef = useRef<HTMLDivElement>(null);
  const stamperRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLElement>(null);
  const degradedRef = useRef(degraded);
  const impactRef = useRef(onImpact);
  useEffect(() => {
    degradedRef.current = degraded;
    impactRef.current = onImpact;
  }, [degraded, onImpact]);

  // The bag rises from below (starts before the first paint).
  useLayoutEffect(() => {
    if (!playing) return;
    const a = play(
      wrapRef.current,
      [
        { transform: "translateY(140px) scale(.85)", opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 650, easing: "cubic-bezier(.3,1.35,.5,1)" },
      false,
    );
    return () => a?.cancel();
  }, [playing]);

  useEffect(() => {
    if (!playing) return;
    const stage = stageRef.current;
    const wrap = wrapRef.current;
    const stamper = stamperRef.current;
    const imp = impRef.current;
    const wave = waveRef.current;
    if (!stage || !wrap || !stamper || !imp || !wave) {
      // Cannot play: show everything at once rather than leave the page hidden.
      setFolded(true);
      impactRef.current();
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const anims: (Animation | null)[] = [];
    const extras: HTMLElement[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const run = (el: Element | null, kf: Keyframe[], o: KeyframeAnimationOptions) => {
      const a = play(el, kf, o, false);
      anims.push(a);
      return a;
    };

    // Seal centre in stage coordinates (offsets ignore the rise transform).
    const cx = wrap.offsetLeft + BAG_WIDTH / 2;
    const cy = wrap.offsetTop + BAG_HEIGHT * 0.335 + BAG_WIDTH * 0.4;
    stamper.style.left = `${cx}px`;
    stamper.style.top = `${cy - STAMPER_W * STAMPER_ASPECT * 0.975 + 4}px`;
    wave.style.left = `${cx}px`;
    wave.style.top = `${cy}px`;

    // 1. fold the top down (PaperBag animates it when `folded` turns true)
    later(560, () => setFolded(true));

    // 2. the stamper rises, hovers, slams
    run(
      stamper,
      [
        { opacity: 0, transform: "translateY(-260px) rotate(-14deg)" },
        { opacity: 1, transform: "translateY(-120px) rotate(-6deg)", offset: 0.55, easing: "cubic-bezier(.6,0,.9,.4)" },
        { opacity: 1, transform: "translateY(-70px) rotate(-8deg)", offset: 0.8, easing: "cubic-bezier(.7,0,1,.6)" },
        { opacity: 1, transform: "translateY(0) rotate(-12deg)" },
      ],
      { duration: 620, delay: IMPACT_AT - 620, fill: "forwards" },
    );

    // 3. impact
    later(IMPACT_AT, () => {
      vibrate([18, 40, 26]);
      bagRef.current?.squash("slam");
      bagRef.current?.jolt(-30000, 60);
      run(
        shakeRef.current,
        [
          { transform: "none" },
          { transform: "translate(-8px,6px) scale(1.02)" },
          { transform: "translate(6px,-4px)" },
          { transform: "translate(-4px,2px)" },
          { transform: "translate(2px,-1px)" },
          { transform: "none" },
        ],
        { duration: 340, easing: "linear" },
      );
      later(150, () =>
        run(
          imp,
          [
            { opacity: 0, filter: "blur(3px)", transform: "rotate(-12deg) scale(1.12)" },
            { opacity: 1, filter: "blur(0)", transform: "rotate(-12deg) scale(.99)", offset: 0.25 },
            { opacity: 0.95, filter: "blur(0)", transform: "rotate(-12deg) scale(1)" },
          ],
          { duration: 700, easing: "ease-out", fill: "forwards" },
        ),
      );
      run(
        wave,
        [
          { transform: "scale(1)", opacity: 0.9, borderWidth: "6px" },
          { transform: "scale(7)", opacity: 0, borderWidth: "1px" },
        ],
        { duration: 620, easing: "cubic-bezier(.1,.7,.3,1)" },
      );
      if (!degradedRef.current) {
        for (let k = 0; k < 14; k++) {
          const s = document.createElement("i");
          s.className = "ord-spl";
          s.style.left = `${cx}px`;
          s.style.top = `${cy}px`;
          stage.appendChild(s);
          extras.push(s);
          const ang = (k / 14) * Math.PI * 2 + Math.random() * 0.4;
          const dist = 70 + Math.random() * 70;
          const sz = 0.4 + Math.random() * 1.1;
          const dx = Math.cos(ang) * dist;
          const dy = Math.sin(ang) * dist * 0.7;
          const a = run(
            s,
            [
              { transform: `translate(0,0) scale(${sz})`, opacity: 1 },
              { transform: `translate(${dx * 0.7}px,${dy * 0.7}px) scale(${sz})`, opacity: 1, offset: 0.5 },
              { transform: `translate(${dx}px,${dy + 40}px) scale(0)`, opacity: 0 },
            ],
            { duration: 620 + Math.random() * 200, easing: "cubic-bezier(.1,.8,.3,1)", fill: "forwards" },
          );
          if (a) void a.finished.then(() => s.remove(), () => undefined);
          else s.remove();
        }
      }
      // press, then lift away
      run(
        stamper,
        [
          { transform: "translateY(0) rotate(-12deg)" },
          { transform: "translateY(6px) rotate(-12deg) scaleY(.96)", offset: 0.2 },
          { transform: "translateY(6px) rotate(-12deg) scaleY(.96)", offset: 0.3, opacity: 1 },
          { transform: "translateY(-160px) rotate(0deg)", offset: 0.75, opacity: 1 },
          { transform: "translateY(-320px) rotate(8deg)", opacity: 0 },
        ],
        { duration: 820, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" },
      );
      impactRef.current();
      later(840, () => setStamperGone(true));
    });

    return () => {
      timers.forEach(clearTimeout);
      anims.forEach((a) => a?.cancel());
      extras.forEach((e) => e.remove());
    };
  }, [playing, shakeRef]);

  return (
    <div ref={stageRef} data-testid="order-stage" className="relative grid h-[390px] place-items-center overflow-visible">
      <div ref={wrapRef} className="mt-10">
        <PaperBag
          ref={bagRef}
          width={BAG_WIDTH}
          items={items}
          folded={folded}
          imprint={
            stamped ? (
              <div
                ref={impRef}
                data-testid="order-stamp"
                className="ord-imprint"
                style={{ opacity: playing ? 0 : 0.92 }}
              >
                <StampSvg orderNo={order.orderNo} />
              </div>
            ) : null
          }
        />
      </div>
      {playing && !stamperGone && (
        <div ref={stamperRef} className="ord-stamper" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/stamper.webp" alt="" width={300} height={382} draggable={false} />
        </div>
      )}
      <i ref={waveRef} className="ord-wave" aria-hidden="true" />
    </div>
  );
}
